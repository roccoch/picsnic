-- Add a human-friendly slug (e.g. "maria-joao-wedding") alongside the UUID.
-- The UUID stays as the primary key / foreign key target; the slug is what
-- clients type in on the login screen.
alter table public.galleries
  add column if not exists slug text;

-- Backfill existing galleries with a slugified name
update public.galleries
set slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
where slug is null;

alter table public.galleries
  alter column slug set not null;

create unique index if not exists galleries_slug_key on public.galleries (slug);
