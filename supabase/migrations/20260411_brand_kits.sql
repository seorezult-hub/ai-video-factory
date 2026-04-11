CREATE TABLE IF NOT EXISTS brand_kits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  brand_name TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE brand_kits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own brand kits" ON brand_kits;
CREATE POLICY "Users can manage own brand kits"
  ON brand_kits FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS brand_kits_user_id_idx ON brand_kits(user_id);
