-- Migration 003: Fix projects table schema
-- Fixes: missing user_id column, mismatched columns, add user_api_keys table
-- Idempotent — safe to run multiple times

-- ─── Fix projects table ──────────────────────────────────────────────────────

-- Create if not exists (full schema with user_id)
CREATE TABLE IF NOT EXISTS projects (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title        TEXT,
  brief        JSONB DEFAULT '{}',
  script       JSONB DEFAULT '{}',
  frames       JSONB DEFAULT '[]',
  video_urls   JSONB DEFAULT '[]',
  current_step INTEGER DEFAULT 1,
  status       TEXT DEFAULT 'draft',
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Add missing columns if table already existed without them
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS title        TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS brief        JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS script       JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS frames       JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS video_urls   JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS current_step INTEGER DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status       TEXT DEFAULT 'draft';

-- Migrate data column to brief if old schema had data/brand_name columns
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'data') THEN
    UPDATE projects SET brief = data WHERE brief = '{}' AND data IS NOT NULL;
  END IF;
END $$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Drop old service_role-only policies (from supabase-setup.sql)
DROP POLICY IF EXISTS "Service access projects" ON projects;

-- Create user-scoped policies (idempotent via DO blocks)
DO $$ BEGIN
  CREATE POLICY "Users see own projects" ON projects
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users create own projects" ON projects
    FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Drop old name variant from 001_initial.sql if exists
DROP POLICY IF EXISTS "Users insert own projects" ON projects;

DO $$ BEGIN
  CREATE POLICY "Users update own projects" ON projects
    FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Users delete own projects" ON projects
    FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS projects_user_id_idx    ON projects(user_id);
CREATE INDEX IF NOT EXISTS projects_updated_at_idx ON projects(updated_at DESC);

-- ─── Auto-update updated_at trigger ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_updated_at ON projects;
CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();

-- ─── user_api_keys table ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_api_keys (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  service       TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, service)
);

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own keys" ON user_api_keys
    FOR ALL USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS user_api_keys_user_id_idx ON user_api_keys(user_id);
