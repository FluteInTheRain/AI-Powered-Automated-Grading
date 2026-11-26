export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export type ProblemMeta = { title: string; category: string; difficulty: Difficulty };

const TITLE_MAX = 80;
const CATEGORY_MAX = 40;

/** Title, category and difficulty from a request body, or an error message. */
export function parseProblemMeta(b: any): ProblemMeta | string {
  const title = typeof b?.title === "string" ? b.title.trim() : "";
  if (!title || title.length > TITLE_MAX) return `title must be 1-${TITLE_MAX} characters`;
  const category = typeof b?.category === "string" ? b.category.trim() : "";
  if (!category || category.length > CATEGORY_MAX) return `category must be 1-${CATEGORY_MAX} characters`;
  if (!DIFFICULTIES.includes(b?.difficulty)) return `difficulty must be one of: ${DIFFICULTIES.join(", ")}`;
  return { title, category, difficulty: b.difficulty };
}

/** Rows created before migration 0004 backfill in SQL; this covers any row that still has NULLs. */
export function metaOrDefault(r: { statement: string; title: string | null; category: string | null; difficulty: string | null }): ProblemMeta {
  return {
    title: r.title ?? r.statement.replace(/\s+/g, " ").trim().slice(0, 60),
    category: r.category ?? "Other",
    difficulty: (DIFFICULTIES as readonly string[]).includes(r.difficulty ?? "") ? (r.difficulty as Difficulty) : "medium",
  };
}
