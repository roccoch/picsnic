-- 1. Add media_type column for image/video rendering
alter table public.photos
  add column if not exists media_type text default 'image';

-- 2. Lock down the galleries table: drop ANY existing policies so the
--    public API can no longer read PINs. Edge functions use the service
--    role key, which bypasses RLS, so verify-gallery-pin keeps working.
alter table public.galleries enable row level security;

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'galleries'
  loop
    execute format('drop policy if exists %I on public.galleries', pol.policyname);
  end loop;
end $$;
