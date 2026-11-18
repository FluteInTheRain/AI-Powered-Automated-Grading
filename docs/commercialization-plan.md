# Commercialization plan

Status: **ideas only, not being pursued.** This project is a portfolio demo and is not
being put in front of real users (Khang, 2026-11-18). The document records how it could be
commercialized, as a reference for design discussions. Nothing here starts unless Khang
asks for it. Feature-level backlog items already tracked in
[`productionization.md`](productionization.md) are referenced by their IDs (PR-xx) and
not repeated.

## Decision

- **First customers:** small private tutoring centers ("trung tâm dạy thêm") that teach
  programming, then self-learners. Universities come later, if at all.
- **Order:** tutoring centers first, self-learners second.
  - Centers bring their own problems, so we don't have to build a content library.
  - Centers have a paying owner.
  - The current app already fits their workflow: a teacher authors a problem, shares a
    link, students submit, the teacher reviews.
  - Self-learners, by contrast, need a problem bank and a learning path, and the market
    is crowded with free options.
- **Positioning:** Vietnamese-language feedback on code quality (efficiency, style, edge
  cases) on top of real test execution.
  - Local judges (Themis, VNOJ-style online judges) report pass/fail only.
  - Score reproducibility and the audit trail help when a parent disputes a score.
  - For this segment they are a bonus, not the reason to buy.

## Why (evidence gathered 2026-11-18)

- **Learners lack feedback on code quality.** Self-taught programmers mostly report
  missing code review: they can make code work but can't tell whether it is good. These
  sources are blog posts and anecdotes, not surveys.
- **Local tools stop at pass/fail.** Vietnamese classrooms and competitive-programming
  training use judges such as Themis, which give a pass/fail verdict per test.
- **Teachers should stay in the loop.** Research on LLM grading of programming work finds
  models agree only moderately with teachers. Human-in-the-loop setups cut grading time
  and keep quality.
- **Detectors cannot be the verdict.** Detectors of AI-written code and keystroke
  signals are unreliable on their own. Use them as signals for the teacher, never as
  proof.
- **Incumbents are cheap and LMS-integrated.** Gradescope prices per student per course,
  reportedly about $1–5. CodeGrade integrates with LMSs over LTI and has an AI assistant.
  Both target universities, which is not this plan's first market.

## Phases

### Phase 0: Validate before building
- [ ] Find 1–2 tutoring centers or teachers willing to try the current app with 2–3 of
  their own problems for one class over 2 weeks.
- [ ] Interview 3–5 teachers or center owners. Ask about their real pain:
  - grading load,
  - parent reporting,
  - copying between students,
  - which languages they teach (Python / C++).
- [ ] Decide the Phase 2 order from that feedback, not from this document.

### Phase 1: Must-haves before strangers use it
- [ ] Teacher accounts plus per-class rate limits and quotas. Today there is no login,
  and anyone can drain the Workers AI quota.
- [ ] Hide hidden test cases after submit, and add a resubmission policy (PR-C2, PR-C3).
- [ ] Sandbox hardening: no isolate reuse between submissions, and no network egress
  (PR-A1; Cloudflare risks 2 and 4 in [`worker/README.md`](../worker/README.md)).
- [ ] Move to Workers Paid. The free tier covers only about 100 graded submits per day
  for the whole app.
- [ ] Vietnamese personal-data compliance check for storing student names and code.

### Phase 2: Tutoring-center features (proposed order)
- [ ] **Classes and homework:** replace one-off exam links with classes. Students submit
  many times before a deadline, and their submission history is kept.
- [ ] **Lightweight student access:** students join a class with a code, no email
  needed. Teachers log in.
- [ ] **Vietnamese feedback, plus hints on failure:** a hint points the student in a
  direction and never gives the answer (CS50-Duck style).
- [ ] **C++ support:** the main language for Informatics olympiad training (PR-A2).
- [ ] **Weekly parent report:** a link or PDF with scores, progress and feedback, easy
  to share over Zalo. This is the owner's retention tool.
- [ ] **Similarity flags within a class:** shown to the teacher only, never an
  automatic accusation (PR-E3).
- [ ] **Import existing problems from Themis/VNOJ test-folder formats,** so centers can
  switch without retyping (PR-B2).

### Phase 3: Self-learners (later)
- [ ] Practice mode with free submits and hints.
- [ ] A shared problem bank, possibly seeded by partner centers.
- [ ] Progress tracking and streaks.

## Unit economics (measured 2026-11-18)

- **Cost per submit:**
  - A graded submit makes 4 Workers AI calls and costs about 100 Neurons (see
    [`worker/README.md`](../worker/README.md)).
  - On Workers Paid that is about **$0.0011 per submit**, at $0.011 per 1,000 Neurons.
    1,000 submits cost about $1.1, plus the $5/month base.
  - These figures come from tokens × the published rate, not from a real bill.
- **What it means for pricing:** a center subscription priced per class per month easily
  covers the LLM cost. The real costs are sandbox hardening, auth, and the time spent on
  operations and support.

## Open questions

- Which languages do target centers actually teach (Python for school curriculum, C++
  for olympiad training, or both)?
- Pricing: per class, per student, or a flat fee per center? What do centers pay for
  tools today?
- Is the grader's Vietnamese feedback good enough? It has not been evaluated.
- Should the platform stay on Cloudflare, or move to a VM with a stronger sandbox, once
  paying users exist?

## Sources

- Gradescope pricing (third-party, unconfirmed):
  https://www.toolsforhumans.ai/ai-tools/gradescope,
  https://aitoolsbakery.com/?p=11586
- CodeGrade LMS integration and AI assistant: https://docs.codegra.de/user/lms.html,
  https://www.eduappcenter.com/apps/1096
- LLM vs teacher agreement (18 LLMs):
  https://www.themoonlight.io/review/a-systematic-comparison-of-large-language-models-for-automated-assignment-assessment-in-programming-education-exploring-the-importance-of-architecture-and-vendor
- Human-in-the-loop grading study:
  https://e-journal.hamzanwadi.ac.id/index.php/edumatic/article/view/35647
- AI-code detection limits:
  https://www.frontiersin.org/journals/computer-science/articles/10.3389/fcomp.2025.1549761/full,
  https://warwick.ac.uk/fac/cross_fac/eduport/edufund/projects/yang/projects/assessing-ai-detectors-in-identifying-ai-generated-code-implications-for-education/
- Keystroke and paste signals:
  https://www.educationaldatamining.org/EDM2024/proceedings/2024.EDM-short-papers.47/2024.EDM-short-papers.47.pdf,
  https://www.bucknell.edu/news/bucknell-research-uses-typing-patterns-detect-ai-assisted-academic-dishonesty
- CS50 Duck: https://cs.harvard.edu/malan/publications/V1fp0567-liu.pdf
- Themis (Vietnamese judge): https://github.com/quyenjd/themisv2,
  https://www.github.com/Belikhun/themis-web-interface
- Self-taught feedback gap (anecdotal):
  https://www.freecodecamp.org/news/lessons-learned-from-my-journey-as-a-self-taught-developer/
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
- EU AI Act (relevant only if selling to EU schools later; high-risk date reportedly
  moved to 2027-12): https://www.learnsignal.com/blog/eu-ai-act-high-risk-rules-delayed-2027/
