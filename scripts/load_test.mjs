#!/usr/bin/env node
// Local load test for app-worker: N students submit one exam at the same time.
// Starts `wrangler dev --local` for app-worker plus a fake grader Worker (scripts/loadtest/fake_grader.mjs) that replaces
// the Python grader and the LLM, then plays N students against it. Nothing here talks to a deployed Worker:
// the script refuses any base URL that is not localhost, and it never runs wrangler with --remote.
//
//   node scripts/load_test.mjs --students 30 --questions 5 --latency-ms 3000 --window-ms 5000
//
// Options (all numeric unless noted):
//   --students 30        concurrent students                --questions 5       questions in the exam
//   --latency-ms 3000    fake grade latency                 --jitter-ms 1000    plus uniform 0..jitter
//   --fail-rate 0        share of grades failing with 502   --window-ms 5000    all submits start inside this window
//   --start-window-ms 2000  spread of the attempt starts    --poll-ms 2000      status poll period (the UI uses 2000)
//   --ip-mode distinct|shared  distinct: each student has own CF-Connecting-IP; shared: one IP (a school NAT)
//   --timeout-ms 600000  a student stops polling a question after this long   --hard-timeout-ms 900000  stop the whole run (result is written with hard_timeout: true)         --port 8799
//   --base-url URL       use an already running localhost dev server instead of spawning one
//   --out results/load_test_<students>.json   --seed 1
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "app-worker");
const args = parseArgs(process.argv.slice(2));
const P = {
  students: num("students", 30), questions: num("questions", 5), latencyMs: num("latency-ms", 3000),
  jitterMs: num("jitter-ms", 1000), failRate: num("fail-rate", 0), windowMs: num("window-ms", 5000),
  startWindowMs: num("start-window-ms", 2000), pollMs: num("poll-ms", 2000), timeoutMs: num("timeout-ms", 600000), hardTimeoutMs: num("hard-timeout-ms", 900000),
  port: num("port", 8799), seed: num("seed", 1), ipMode: args["ip-mode"] ?? "distinct",
};
P.out = args.out ?? join(root, "results", `load_test_${P.students}_${P.ipMode}.json`);

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) o[argv[i].slice(2)] = argv[i + 1] ?? "true", i++;
  return o;
}
function num(k, d) { const v = args[k] === undefined ? d : Number(args[k]); if (!Number.isFinite(v)) throw new Error(`--${k} must be a number`); return v; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Small seeded generator so a rerun draws the same start and submit offsets.
let rng = P.seed >>> 0;
const rand = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 2 ** 32);

let base = args["base-url"] ?? `http://127.0.0.1:${P.port}`;
{
  const host = new URL(base).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") throw new Error(`refusing to load test ${host}: only localhost is allowed`);
}

// ---------------------------------------------------------------- local stack
let dev = null;
let state = null;
async function startStack() {
  const work = mkdtempSync(join(tmpdir(), "loadtest-"));
  state = join(work, "state");
  const fakeCfg = join(work, "fake-grader.jsonc");
  writeFileSync(fakeCfg, JSON.stringify({
    name: "grading", main: join(root, "scripts/loadtest/fake_grader.mjs"), compatibility_date: "2026-11-01",
    vars: { FAKE_LATENCY_MS: String(P.latencyMs), FAKE_JITTER_MS: String(P.jitterMs), FAKE_FAIL_RATE: String(P.failRate) },
  }));
  mkdirSync(join(root, "app-ui/dist"), { recursive: true }); // the assets directory must exist (it is gitignored)
  const wr = (a) => execFileSync("npx", ["wrangler", ...a], { cwd: appDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  wr(["d1", "migrations", "apply", "teacher-app", "--local", "--persist-to", state]);
  wr(["d1", "execute", "teacher-app", "--local", "--persist-to", state, "--file", "seed/bank.sql"]);
  const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
  dev = spawn("npx", [
    "wrangler", "dev", "--local", "-c", "wrangler.jsonc", "-c", fakeCfg, "--port", String(P.port), "--persist-to", state,
    "--var", "DEV_AUTH_BYPASS:1", "--var", "LOADTEST_SKIP_TURNSTILE:1", "--var", "INTERNAL_TOKEN:local",
  ], { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  dev.stdout.on("data", (d) => (log += d));
  dev.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    if (dev.exitCode !== null) throw new Error(`wrangler dev exited early:\n${log.slice(-3000)}`);
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`wrangler dev did not come up:\n${log.slice(-3000)}`);
}
const d1 = (sql) => JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "teacher-app", "--local", "--persist-to", state, "--json", "--command", sql],
  { cwd: appDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0].results;

// ---------------------------------------------------------------- the students
const counts = { http: 0, byStatus: {} };
const lat = { start: [], submit: [], poll: [] };
const errors = [];
async function call(kind, method, path, { body, headers = {} } = {}) {
  const t0 = performance.now();
  let res, text = "";
  try {
    res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    text = await res.text();
  } catch (e) {
    counts.byStatus.network = (counts.byStatus.network ?? 0) + 1;
    errors.push({ kind, path, error: String(e) });
    return { status: 0, json: null, ms: performance.now() - t0 };
  }
  const ms = performance.now() - t0;
  counts.http++;
  counts.byStatus[res.status] = (counts.byStatus[res.status] ?? 0) + 1;
  if (lat[kind]) lat[kind].push(ms);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  if (res.status >= 400 && res.status !== 429) errors.push({ kind, path, status: res.status, detail: json?.detail });
  return { status: res.status, json, ms };
}
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : null);
const round = (x) => (typeof x === "number" ? Math.round(x * 10) / 10 : x);
const stats = (a) => ({ n: a.length, p50: round(pct(a, 50)), p95: round(pct(a, 95)), max: round(pct(a, 100)) });

async function main() {
  if (!args["base-url"]) await startStack();
  const ipFor = (i) => (P.ipMode === "shared" ? "10.0.0.1" : `10.1.${(i >> 8) & 255}.${i & 255}`);
  const teacher = { "X-Dev-Teacher": "loadtest@example.invalid" };
  const bank = (await call("other", "GET", "/api/teacher/bank", { headers: teacher })).json;
  if (!Array.isArray(bank) || bank.length < P.questions) throw new Error(`bank has ${bank?.length} problems, need ${P.questions}`);
  const exam = (await call("other", "POST", "/api/teacher/exams", {
    headers: teacher, body: { title: `load test ${Date.now()}`, questions: bank.slice(0, P.questions).map((p) => ({ problem_id: p.id, weight: 1 })) },
  })).json;
  const token = exam.student_token;

  const t0 = performance.now();
  const at = () => performance.now() - t0;
  const students = Array.from({ length: P.students }, (_, i) => ({
    i, ip: ipFor(i), startAt: rand() * P.startWindowMs, submitAt: P.startWindowMs + 500 + rand() * P.windowMs,
    q: {}, rejected: { start: 0, submit: 0 },
  }));
  const timeline = []; // {t, queued, grading, done, failed} sampled every second
  let submitsAccepted = 0, lastSubmitAccepted = 0;

  async function student(s) {
    const h = { "CF-Connecting-IP": s.ip };
    await sleep(Math.max(0, s.startAt - at()));
    let r;
    for (let tries = 0; tries < 20; tries++) {            // a student told "slow down" tries again after a pause
      r = await call("start", "POST", `/api/exam/${token}/attempts`, { headers: h, body: { student_name: `student ${s.i}` } });
      if (r.status !== 429) break;
      s.rejected.start++;
      await sleep(3000);
    }
    if (r.status !== 200) { s.failed = `start ${r.status}`; return; }
    const { attempt_id: aid, questions } = r.json;
    s.aid = aid;
    await sleep(Math.max(0, s.submitAt - at()));
    const answers = Object.fromEntries(questions.map((q) => [q.problem_id, `def ${"f"}(x):\n    return x  # student ${s.i}\n`]));
    for (let tries = 0; tries < 20; tries++) {
      r = await call("submit", "POST", `/api/exam/${token}/attempts/${aid}/submit`, { headers: h, body: { answers } });
      if (r.status !== 429) break;
      s.rejected.submit++;
      await sleep(3000);
    }
    if (r.status !== 202) { s.failed = `submit ${r.status}`; return; }
    s.submitMs = r.ms; s.acceptedAt = at(); submitsAccepted++; lastSubmitAccepted = Math.max(lastSubmitAccepted, s.acceptedAt);
    // One poll loop per question, every pollMs, as the exam page does.
    await Promise.all(questions.map(async (q) => {
      for (;;) {
        await sleep(P.pollMs);
        if (at() > P.timeoutMs) { s.q[q.problem_id] = "timeout"; return; }
        const p = await call("poll", "GET", `/api/exam/${token}/attempts/${aid}/questions/${q.problem_id}/status`, { headers: h });
        if (p.status === 429) { s.rejected.poll = (s.rejected.poll ?? 0) + 1; continue; }
        s.q[q.problem_id] = p.json?.status ?? "error";
        if (p.json?.status === "done" || p.json?.status === "failed") { s.q[q.problem_id + "@"] = at(); return; }
      }
    }));
    s.doneAt = Math.max(...Object.keys(s.q).filter((k) => k.endsWith("@")).map((k) => s.q[k]));
  }

  const sampler = setInterval(() => {
    const t = { t: Math.round(at() / 1000), queued: 0, grading: 0, done: 0, failed: 0 };
    for (const s of students) for (const [k, v] of Object.entries(s.q)) if (!k.endsWith("@") && v in t) t[v]++;
    timeline.push(t);
  }, 1000);
  let hardTimeout = false;
  await Promise.race([
    Promise.all(students.map(student)),
    sleep(P.hardTimeoutMs).then(() => { hardTimeout = true; }),
  ]);
  clearInterval(sampler);
  const totalMs = at();

  // Scores through the by-receipt route are a check that every question got a score.
  let scored = 0;
  for (const s of students) if (s.aid) scored += s.q && Object.entries(s.q).filter(([k, v]) => !k.endsWith("@") && v === "done").length;
  const jobs = args["base-url"] ? null : d1("SELECT status, count(*) AS n, sum(attempts) AS deliveries FROM grading_jobs GROUP BY status");
  const deliveries = jobs ? jobs.reduce((a, r) => a + (r.deliveries ?? 0), 0) : null;
  const questionsTotal = P.students * P.questions;
  const lastDone = Math.max(0, ...students.map((s) => s.doneAt ?? 0));
  const peak = (key) => Math.max(0, ...timeline.map((t) => t[key]));
  const result = {
    note: "Local simulation: fake grader with a fixed delay, wrangler dev --local (Miniflare). Not a measurement of production.",
    hard_timeout: hardTimeout, params: P, wrangler_local: !args["base-url"],
    students_started: students.filter((s) => s.aid).length, submits_accepted: submitsAccepted,
    questions_total: questionsTotal, questions_done: scored,
    submit_window_s: +((Math.max(...students.map((s) => s.submitAt)) - Math.min(...students.map((s) => s.submitAt))) / 1000).toFixed(1),
    accept_ms: { start: stats(lat.start), submit: stats(lat.submit), poll: stats(lat.poll) },
    last_submit_accepted_s: +(lastSubmitAccepted / 1000).toFixed(1),
    last_score_s: +(lastDone / 1000).toFixed(1),
    last_score_after_last_accept_s: +((lastDone - lastSubmitAccepted) / 1000).toFixed(1),
    per_student_wait_s: stats(students.filter((s) => s.doneAt && s.acceptedAt).map((s) => (s.doneAt - s.acceptedAt) / 1000)),
    peak_backlog_queued: peak("queued"), peak_grading_at_once: peak("grading"),
    http_requests: counts.http, http_by_status: counts.byStatus,
    rate_limit_rejections: { start: students.reduce((a, s) => a + s.rejected.start, 0), submit: students.reduce((a, s) => a + s.rejected.submit, 0), poll: students.reduce((a, s) => a + (s.rejected.poll ?? 0), 0) },
    students_failed: students.filter((s) => s.failed).map((s) => ({ i: s.i, why: s.failed })),
    grading_jobs: jobs, queue_deliveries_total: deliveries, retries: deliveries === null ? null : deliveries - questionsTotal,
    errors: errors.slice(0, 20), error_count: errors.length, total_run_s: +(totalMs / 1000).toFixed(1), timeline,
  };
  mkdirSync(dirname(P.out), { recursive: true });
  writeFileSync(P.out, JSON.stringify(result, null, 2));
  const { timeline: _t, errors: _e, ...brief } = result;
  console.log(JSON.stringify(brief, null, 2));
  console.log(`\nfull result (with timeline): ${P.out}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { if (dev) dev.kill("SIGINT"); setTimeout(() => process.exit(), 500); });
