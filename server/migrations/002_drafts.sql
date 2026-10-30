CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  original_resume TEXT NOT NULL,
  tailored_resume TEXT NOT NULL,
  gaps TEXT NOT NULL DEFAULT '[]',
  answers TEXT NOT NULL DEFAULT '[]',
  cover_letter TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
