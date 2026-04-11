-- Migration 004: Add frames, video_urls, current_step columns to projects
-- БАГ-002 / БАГ-003 supplement
-- Idempotent — safe to run multiple times

ALTER TABLE projects ADD COLUMN IF NOT EXISTS frames       JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS video_urls   JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 1;

DO $$ BEGIN
  CREATE POLICY "Users delete own projects" ON projects
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS projects_user_id_idx       ON projects(user_id);
CREATE INDEX IF NOT EXISTS projects_updated_at_idx    ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS user_api_keys_user_id_idx  ON user_api_keys(user_id);
