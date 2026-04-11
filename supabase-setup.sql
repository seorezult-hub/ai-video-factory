-- ============================================================
-- AI Video Factory — Supabase Setup
-- Выполни в: https://supabase.com/dashboard/project/xpnhydxwsbacuavcwmzb/sql
-- ============================================================

-- 1. Создать bucket "videos" (публичный)
INSERT INTO storage.buckets (id, name, public)
VALUES ('videos', 'videos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. Создать bucket "assets" (публичный — для @Image ассетов брендов)
INSERT INTO storage.buckets (id, name, public)
VALUES ('assets', 'assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 3. Политики доступа — только сервисный ключ пишет, все читают
-- Удаляем старые open-политики если существуют
DROP POLICY IF EXISTS "Public upload videos" ON storage.objects;
DROP POLICY IF EXISTS "Public upload assets" ON storage.objects;

CREATE POLICY "Public read videos" ON storage.objects
  FOR SELECT USING (bucket_id = 'videos');

-- Запись только через service_role (API-ключ не передаётся клиенту)
CREATE POLICY "Service write videos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'videos' AND auth.role() = 'service_role');

CREATE POLICY "Public read assets" ON storage.objects
  FOR SELECT USING (bucket_id = 'assets');

CREATE POLICY "Service write assets" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'assets' AND auth.role() = 'service_role');

-- 4. Таблица задач для отслеживания статуса генерации
CREATE TABLE IF NOT EXISTS tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,       -- 'frames', 'video', 'assemble'
  status TEXT DEFAULT 'pending', -- pending, processing, done, error
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS на tasks — только сервисный ключ читает/пишет
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service access tasks" ON tasks;
CREATE POLICY "Service access tasks" ON tasks
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 5. Таблица feedback для RAG (фаза 4)
CREATE TABLE IF NOT EXISTS prompt_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scene_prompt TEXT NOT NULL,
  visual_result_url TEXT,
  score INTEGER CHECK (score IN (1, 3, 5)),
  industry TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS на prompt_feedback — только сервисный ключ читает/пишет
ALTER TABLE prompt_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service access prompt_feedback" ON prompt_feedback;
CREATE POLICY "Service access prompt_feedback" ON prompt_feedback
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- 6. Таблица проектов — сохранение между сессиями
CREATE TABLE IF NOT EXISTS projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  brand_name TEXT,
  data JSONB NOT NULL,
  current_step INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service access projects" ON projects;
CREATE POLICY "Service access projects" ON projects
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
