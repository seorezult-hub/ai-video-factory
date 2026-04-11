-- Migration 005: RLS fixes for tasks and prompt_feedback tables
-- Bug fixes: tasks has no user_id scoping, prompt_feedback missing SELECT policy
-- Idempotent — safe to run multiple times

-- ─── tasks: add user_id column for proper scoping ─────────────────────────────

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);

-- Drop old service_role-only policy
DROP POLICY IF EXISTS "Service access tasks" ON tasks;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- service_role can do everything (server-side job management)
DO $$ BEGIN
  CREATE POLICY "Service full access tasks" ON tasks
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Users can only read their own tasks
DO $$ BEGIN
  CREATE POLICY "Users read own tasks" ON tasks
    FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── prompt_feedback: add SELECT policy for users ─────────────────────────────
-- Feedback is write-only for users (server writes, not users), service_role reads all

ALTER TABLE prompt_feedback ENABLE ROW LEVEL SECURITY;

-- Drop and recreate to ensure correct permissions
DROP POLICY IF EXISTS "Service access prompt_feedback" ON prompt_feedback;

DO $$ BEGIN
  CREATE POLICY "Service full access prompt_feedback" ON prompt_feedback
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
