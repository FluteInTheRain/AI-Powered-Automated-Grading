import { newId } from "../ids";
import type { Teacher } from "../env";

/** Find or create the teacher for an email (stored lower-case). */
export async function upsertTeacher(db: D1Database, email: string): Promise<Teacher> {
  const e = email.trim().toLowerCase();
  await db
    .prepare("INSERT OR IGNORE INTO teachers (id, email, created_at) VALUES (?, ?, ?)")
    .bind(newId(), e, new Date().toISOString())
    .run();
  const row = await db.prepare("SELECT id, email FROM teachers WHERE email = ?").bind(e).first<Teacher>();
  if (!row) throw new Error("teacher upsert failed");
  return row;
}
