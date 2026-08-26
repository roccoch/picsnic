## Tech Stack
- **Frontend:** React 19 + Vite
- **Auth & Database:** Supabase (PostgreSQL, Row Level Security, anonymous auth)
- **Storage:** Cloudflare R2 (S3-compatible, zero egress fees, 10 GB free)
- **Backend:** Supabase Edge Functions (Deno)

## Features
- [x] Responsive Apple Photos-style grid
- [x] Cloudflare R2 storage with presigned URL uploads
- [x] Image **and video** support
- [x] Server-side gallery PIN verification
- [x] Database schema with RLS
- [x] Anonymous client authentication
- [x] Upload progress bar
- [x] Delete own uploads (R2 object + DB row)
- [x] Cross-origin downloads that actually download
- [ ] Client gallery sharing via links
- [ ] Bulk download
- [ ] Photographer dashboard / self-serve gallery creation

## Architecture
The client never sees R2 credentials. All sensitive work happens in edge functions:

```
Client --(1) PIN--> verify-gallery-pin --(service role, checks DB)--> grants access
Client --(2) JWT + metadata--> generate-upload-url --(validates auth, type, size)
     --(3) PUT directly to R2 with presigned URL--> Cloudflare R2
Client --(4) JWT + photoId--> delete-file --(checks ownership, deletes R2 object + DB row)
```

Three edge functions:
| Function | Auth | Purpose |
|---|---|---|
| `verify-gallery-pin` | none (verify_jwt=false) | Validates gallery slug + PIN server-side so PINs are never exposed via the public API |
| `create-gallery` | admin password secret | Creates a gallery (name, slug, PIN) from the in-app Admin screen |
| `generate-upload-url` | JWT required | Validates the session and file type/size, returns a content-type-locked presigned R2 URL |
| `delete-file` | JWT required | Deletes the R2 object and DB row, only for the uploader |

Galleries are identified on the login screen by a human-friendly **slug**
(e.g. `maria-joao-2026`), never by UUID. The UUID stays internal as the
primary key. Create galleries either from the in-app **Admin** screen
(password = `ADMIN_PASSWORD` secret) or via SQL:
```sql
insert into galleries (name, slug, pin) values ('Maria & João Wedding', 'maria-joao-2026', '1234');
```

### Prerequisites
- Node.js (v18+)
- [Supabase CLI](https://supabase.com/docs/guides/cli) installed
- A Cloudflare account with R2 enabled
- A Supabase account

### Installation

1. Clone the repo
```bash
git clone https://github.com/yourusername/picsnic.git
cd picsnic
```

2. Install NPM packages
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.example .env
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY — these are safe for the browser.
# R2 credentials NEVER go here; they are set as edge function secrets (step 6).
```

4. Set up the database

Run the following SQL in the Supabase SQL Editor:

```sql
-- Galleries (PIN is only readable server-side; NO public select policy)
create table galleries (
  id uuid default gen_random_uuid() primary key,
  name text,
  pin text not null,
  photographer_id uuid references auth.users(id),
  created_at timestamp default now()
);
alter table galleries enable row level security;
-- Intentionally no policies: only edge functions (service role) can read this table.

-- Photos
create table photos (
  id uuid default uuid_generate_v4() primary key,
  title text,
  url text,
  media_type text default 'image',
  photographer_id uuid references auth.users(id) on delete cascade,
  gallery_id uuid references galleries(id) on delete cascade,
  created_at timestamp default now()
);

alter table photos enable row level security;

-- Anyone can view photos (files are on a public R2 bucket anyway)
create policy "Public can view photos" on photos for select using (true);

-- Only signed-in users (including anonymous sessions) can upload
create policy "Authenticated uploads" on photos for insert
with check (auth.uid() = photographer_id);

-- Only the uploader can delete
create policy "Owner can delete" on photos for delete
using (auth.uid() = photographer_id);

-- If you already created the photos table earlier, just run:
-- alter table photos add column if not exists media_type text default 'image';
```

5. Enable anonymous sign-ins

Dashboard → Authentication → Sign In / Up → enable **Anonymous** sign-ins.

6. Deploy the edge functions

```bash
supabase login
supabase link --project-ref your-project-ref
supabase secrets set \
  R2_ACCESS_KEY_ID=your_r2_access_key \
  R2_SECRET_ACCESS_KEY=your_r2_secret \
  R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com \
  R2_BUCKET_NAME=picsnic-storage \
  R2_PUBLIC_URL=https://pub-<id>.r2.dev \
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
supabase functions deploy
```

### Cloudflare R2 setup (free tier: 10 GB, zero egress)

1. Dashboard → **R2** → enable it.
2. Create a bucket (e.g. `picsnic-storage`) and use **that exact name** for `R2_BUCKET_NAME`.
3. R2 → Manage API Tokens → create a token with **Object Read & Write scoped to this bucket only** (never the account-wide token).
4. Bucket Settings → enable the **r2.dev public URL** (or attach a custom domain). That URL is your `R2_PUBLIC_URL`.
5. Bucket Settings → **CORS policy** (required for browser uploads and blob downloads):
```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://192.168.100.26:5173"
    ],
    "AllowedMethods": ["PUT", "GET", "DELETE"],
    "AllowedHeaders": ["content-type"],
    "MaxAgeSeconds": 3600
  }
]
```

The origin must match **exactly what appears in the visitor's address bar**:
scheme + host + port. `http://localhost:5173` only covers the PC's own
browser — phones on your WiFi hit your PC's LAN IP (e.g.
`http://192.168.100.26:5173`), and a deployed site hits your
`https://yourproject.pages.dev` domain. Add one origin per way you serve
the app (or `"*"` temporarily for a demo). Remember to run
`npm run dev -- --host`, otherwise the dev server is not reachable from
the LAN at all.

### Run it

```bash
npm run dev
```
