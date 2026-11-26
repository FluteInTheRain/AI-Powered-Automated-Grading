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

export type TeacherSettings = { default_rubric?: Record<string, number>; default_time_limit_seconds?: number };

export async function getSettings(db: D1Database, teacherId: string): Promise<TeacherSettings> {
  const row = await db.prepare("SELECT settings FROM teachers WHERE id = ?").bind(teacherId).first<{ settings: string }>();
  return row ? JSON.parse(row.settings) : {};
}

/** Replaces the teacher's settings with an already validated object. */
export async function putSettings(db: D1Database, teacherId: string, s: TeacherSettings): Promise<void> {
  await db.prepare("UPDATE teachers SET settings = ? WHERE id = ?").bind(JSON.stringify(s), teacherId).run();
}
