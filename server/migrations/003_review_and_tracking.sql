ALTER TABLE jobs ADD COLUMN approved_at TEXT;
ALTER TABLE jobs ADD COLUMN submitted_at TEXT;
ALTER TABLE drafts ADD COLUMN resume_version TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS job_events (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_created_at ON job_events(created_at);

CREATE TABLE IF NOT EXISTS application_attempts (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '{}',
  resume_version TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('automation_paused', '0');
