-- AI Video Factory — Initial Schema
-- Run in Supabase SQL Editor

-- Enable pgvector for RAG (prompt library)
create extension if not exists vector;

-- ─── Projects ────────────────────────────────────────────────────────────────

create table if not exists projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  title       text not null default '',
  status      text not null default 'draft'
                check (status in ('draft', 'scripting', 'framing', 'generating', 'assembling', 'done', 'failed')),
  video_type  text not null,
  brief       jsonb not null default '{}',   -- brandName, mood, audience, etc.
  script      jsonb,                          -- array of SceneScript
  keyframes   jsonb,                          -- array of R2/Storage URLs
  video_clips jsonb,                          -- array of R2/Storage URLs
  music_url   text,
  final_url   text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table projects enable row level security;

create policy "Users see own projects"
  on projects for select using (auth.uid() = user_id);

create policy "Users insert own projects"
  on projects for insert with check (auth.uid() = user_id);

create policy "Users update own projects"
  on projects for update using (auth.uid() = user_id);

-- ─── Prompt Library (RAG) ────────────────────────────────────────────────────

create table if not exists prompts (
  id           uuid primary key default gen_random_uuid(),
  category     text not null,   -- cosmetics, fashion, food, music, tech, real_estate
  level        int  not null,   -- 1 basic, 2 commercial, 3 advanced
  prompt_text  text not null,
  scene_type   text,            -- product_shot, lifestyle, close_up, etc.
  camera_move  text,
  mood         text,
  rating       float default 0, -- 0-5, updated by feedback
  use_count    int   default 0,
  embedding    vector(1536),    -- for semantic search (text-embedding-ada-002 or Gemini)
  created_at   timestamptz default now()
);

create index if not exists prompts_category_idx on prompts(category);
create index if not exists prompts_rating_idx on prompts(rating desc);
create index if not exists prompts_embedding_idx
  on prompts using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ─── Feedback ────────────────────────────────────────────────────────────────

create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references projects(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  scene_index int  not null,
  stage       text not null check (stage in ('keyframe', 'video_clip', 'final')),
  rating      int  not null check (rating in (-1, 0, 1)),  -- -1 bad, 0 neutral, 1 good
  prompt_used text,
  model_used  text,
  created_at  timestamptz default now()
);

alter table feedback enable row level security;

create policy "Users insert own feedback"
  on feedback for insert with check (auth.uid() = user_id);

-- ─── Generation Jobs (for n8n integration) ────────────────────────────────────

create table if not exists jobs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references projects(id) on delete cascade,
  job_type     text not null check (job_type in ('script', 'frames', 'video', 'music', 'assemble')),
  status       text not null default 'pending'
                 check (status in ('pending', 'running', 'done', 'failed')),
  input        jsonb,
  output       jsonb,
  error        text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz default now()
);

-- ─── Auto-update updated_at ───────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_updated_at
  before update on projects
  for each row execute procedure update_updated_at();

-- ─── Supabase Storage bucket ──────────────────────────────────────────────────

-- Run this in Supabase Dashboard → Storage → New bucket:
-- Name: videos
-- Public: true (for serving final videos)
-- File size limit: 500 MB
