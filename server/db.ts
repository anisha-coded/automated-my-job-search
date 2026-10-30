import "dotenv/config";
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.DATABASE_PATH ?? join(here, "../.data/jobs.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
const applied = db.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>;
const appliedNames = new Set(applied.map((row) => row.name));
const recordMigration = db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");

for (const name of readdirSync(join(here, "migrations")).filter((file) => file.endsWith(".sql")).sort()) {
  if (appliedNames.has(name)) continue;
  const migration = readFileSync(join(here, "migrations", name), "utf8");
  db.transaction(() => {
    db.exec(migration);
    recordMigration.run(name, new Date().toISOString());
  }).immediate();
}
