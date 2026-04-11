-- BUG-007: сделать bucket assets приватным + RLS политики
UPDATE storage.buckets SET public = false WHERE id = 'assets';

CREATE POLICY "users read own assets" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'assets' AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "users insert own assets" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'assets' AND (storage.foldername(name))[1] = auth.uid()::text
  );
