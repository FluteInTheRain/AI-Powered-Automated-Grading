/**
 * Code-similarity SIGNAL (PR-E3). Pure functions, no I/O, no Buffer, no LLM.
 *
 * It tells a teacher "these two submissions are worth a second look". It is never a verdict and never touches a score.
 *
 * Pipeline per submission: tokenize Python source -> drop comments, docstrings and whitespace, blank out string content ->
 * rename every user identifier to ID, every number to NUM, every string to STR (keywords and common builtins stay) ->
 * k-gram shingles over the token stream -> Jaccard similarity of two shingle sets.
 * Renaming variables, changing comments, spacing or literal values therefore does not change the score;
 * reordering statements or restructuring the logic does.
 *
 * Thresholds (see docs/similarity-check.md for the reasoning):
 * - MIN_TOKENS = 40: a submission shorter than this, after the starter code's shingles are removed, is never compared.
 *   A one-line sum or a short loop has only a handful of sensible shapes, so identical-looking pairs prove nothing.
 * - SHINGLE_K = 5 tokens: long enough that matching shingles reflect shared structure, short enough to survive small edits.
 * - SIMILARITY_THRESHOLD = 0.85: a pair is listed only when 85% of the combined shingles are shared.
 * - A submission that itself reaches the threshold against the reference solution is skipped as a "common solution":
 *   every correct student converges on it, so a match between two such students says nothing.
 */

export const MIN_TOKENS = 40;
export const SHINGLE_K = 5;
export const SIMILARITY_THRESHOLD = 0.85;
/** Per question: at most this many submissions are compared (pair count grows with the square; Workers CPU is small). */
export const MAX_SUBMISSIONS = 150;
export const MAX_PAIRS_PER_QUESTION = 20;

const KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield",
  // builtin functions whose use shapes the algorithm (method names such as values/get/add are NOT listed: they are common variable names); kept so unrelated solutions do not collapse into the same ID soup
  "len", "range", "print", "sum", "min", "max", "sorted", "reversed", "abs", "int", "str", "float", "bool", "list",
  "dict", "set", "tuple", "enumerate", "zip", "map", "filter", "any", "all", "isinstance",
]);

const TOKEN_RE = new RegExp(
  [
    "#[^\\n]*", // comment
    "[rRbBuUfF]{0,2}(?:\"\"\"[\\s\\S]*?(?:\"\"\"|$)|'''[\\s\\S]*?(?:'''|$))", // triple-quoted string / docstring
    "[rRbBuUfF]{0,2}(?:\"(?:\\\\.|[^\"\\\\\\n])*\"?|'(?:\\\\.|[^'\\\\\\n])*'?)", // string
    "\\d[\\d_]*(?:\\.\\d*)?(?:[eE][+-]?\\d+)?|\\.\\d+", // number
    "[A-Za-z_][A-Za-z_0-9]*", // identifier or keyword
    "\\*\\*=?|//=?|<<=?|>>=?|[=!<>+\\-*/%&|^:]=|->|:=|\\S", // operator / punctuation
  ].join("|"),
  "g",
);

/** Normalized token stream: comments and whitespace dropped, strings -> STR, numbers -> NUM, user names -> ID. */
export function normalize(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(TOKEN_RE)) {
    const t = m[0];
    const c = t[0];
    if (c === "#") continue;
    // Triple-quoted strings are docstrings or block comments in practice; dropping them stops a docstring hiding a copy.
    if (/^[rRbBuUfF]{0,2}("""|''')/.test(t)) continue;
    if (/^[rRbBuUfF]{0,2}["']/.test(t)) out.push("STR");
    else if (/^[\d.]/.test(c) && /\d/.test(t)) out.push("NUM");
    else if (/^[A-Za-z_]/.test(c)) out.push(KEYWORDS.has(t) ? t : "ID");
    else out.push(t);
  }
  return out;
}

export function shingles(tokens: string[], k = SHINGLE_K): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i + k <= tokens.length; i++) s.add(tokens.slice(i, i + k).join(" "));
  return s;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export type SimilarityInput = { id: string; code: string };
export type SimilarPair = { a: string; b: string; similarity: number };
export type SimilarityResult = {
  /** Submissions that were long enough and not the common solution. */
  compared: number;
  /** Submissions left out: too short, an unchanged starter, or equal to the reference solution. */
  skipped: number;
  /** True when more than MAX_SUBMISSIONS were eligible and only the first ones were compared. */
  truncated: boolean;
  pairs: SimilarPair[];
};

/** Compare the submissions of ONE question. `starter` and `reference` are that question's starter code and reference solution. */
export function findSimilarPairs(subs: SimilarityInput[], starter: string, reference: string): SimilarityResult {
  const starterTokens = normalize(starter);
  const starterShingles = shingles(starterTokens);
  const referenceShingles = shingles(normalize(reference));
  const eligible: { id: string; sh: Set<string> }[] = [];
  let skipped = 0;
  for (const s of subs) {
    const tokens = normalize(s.code);
    const sh = new Set([...shingles(tokens)].filter((x) => !starterShingles.has(x)));
    // Length is judged without the starter code every student begins with.
    const own = tokens.length - starterTokens.length;
    if (own < MIN_TOKENS || sh.size === 0 || jaccard(sh, referenceShingles) >= SIMILARITY_THRESHOLD) { skipped++; continue; }
    eligible.push({ id: s.id, sh });
  }
  const truncated = eligible.length > MAX_SUBMISSIONS;
  const list = truncated ? eligible.slice(0, MAX_SUBMISSIONS) : eligible;
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const x = list[i].sh, y = list[j].sh;
      // Jaccard <= min/max, so a pair whose sizes differ this much cannot reach the threshold.
      if (Math.min(x.size, y.size) / Math.max(x.size, y.size) < SIMILARITY_THRESHOLD) continue;
      const sim = jaccard(x, y);
      if (sim >= SIMILARITY_THRESHOLD) pairs.push({ a: list[i].id, b: list[j].id, similarity: Math.round(sim * 100) / 100 });
    }
  }
  pairs.sort((p, q) => q.similarity - p.similarity);
  return { compared: list.length, skipped, truncated, pairs: pairs.slice(0, MAX_PAIRS_PER_QUESTION) };
}
