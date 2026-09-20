import { sql } from "drizzle-orm";
import type { RigmateDatabase } from "./client";

export function migrateSchema(db: RigmateDatabase): void {
  db.run(sql`CREATE TABLE IF NOT EXISTS builds (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    use_case text,
    budget_cents integer,
    status text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS build_items (
    id text PRIMARY KEY NOT NULL,
    build_id text NOT NULL,
    category text NOT NULL,
    label text NOT NULL,
    spec text NOT NULL DEFAULT '{}',
    price_cents integer,
    source text,
    created_at text NOT NULL
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS check_runs (
    id text PRIMARY KEY NOT NULL,
    build_id text NOT NULL,
    created_at text NOT NULL,
    status text NOT NULL,
    items_snapshot text NOT NULL DEFAULT '[]'
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS findings (
    id text PRIMARY KEY NOT NULL,
    check_run_id text NOT NULL,
    rule_id text NOT NULL,
    status text NOT NULL,
    payload text NOT NULL
  )`);

  const columns = db.all<{ name: string }>(sql`PRAGMA table_info(build_items)`);
  const names = columns.map((column) => column.name);

  if (!names.includes("spec")) {
    db.run(sql`ALTER TABLE build_items ADD COLUMN spec text NOT NULL DEFAULT '{}'`);
  }

  if (!names.includes("price_cents")) {
    db.run(sql`ALTER TABLE build_items ADD COLUMN price_cents integer`);
  }

  if (names.includes("socket")) {
    const legacyRows = db.all<{ id: string; socket: string | null }>(
      sql`SELECT id, socket FROM build_items WHERE socket IS NOT NULL`,
    );
    for (const row of legacyRows) {
      db.run(
        sql`UPDATE build_items SET spec = ${JSON.stringify({ socket: row.socket })} WHERE id = ${row.id}`,
      );
    }
    db.run(sql`ALTER TABLE build_items DROP COLUMN socket`);
  }

  const checkRunColumns = db.all<{ name: string }>(sql`PRAGMA table_info(check_runs)`);
  const checkRunNames = checkRunColumns.map((column) => column.name);
  if (!checkRunNames.includes("items_snapshot")) {
    db.run(sql`ALTER TABLE check_runs ADD COLUMN items_snapshot text NOT NULL DEFAULT '[]'`);
  }
}
