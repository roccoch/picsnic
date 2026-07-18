## Tech Stack
- **Frontend:** React 19 + Vite
- **Auth & Database:** Supabase (PostgreSQL)
- **Storage:** Cloudflare R2 (S3-compatible, zero egress fees)
- **Backend:** Supabase Edge Functions (Deno)

## Features (In Progress)
- [x] Responsive Apple Photos-style grid
- [x] Cloudflare R2 storage setup
- [x] Secure presigned URL uploads
- [x] Database schema with RLS
- [x] Photographer authentication
- [ ] Client gallery sharing via links
- [ ] Bulk download
- [ ] Video support

## Architecture
this app uses a serverless edge Function to generate a temporary, presigned S3 URL. The client uploads the file *directly* to Cloudflare R2, bypassing the server entirely — handling large files without consuming much server bandwidth.

```
Client then Edge Function (signs URL, holds credentials)  then R2 (validates signature, accepts upload)
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
# Fill in your Supabase and R2 credentials in .env — never commit this file
```

4. Set up the Supabase database

Run the following SQL in your Supabase SQL Editor to create the `photos` table with proper Row Level Security:

```sql
-- Create the photos table with relationships
create table photos (
  id uuid default uuid_generate_v4() primary key,
  title text,
  url text,
  photographer_id uuid references auth.users(id) on delete cascade,
  gallery_id uuid default gen_random_uuid(),
  created_at timestamp default now()
);

-- Enable Row Level Security
alter table photos enable row level security;

-- Anyone can view photos (clients don't need to log in)
create policy "Public can view photos" on photos for select using (true);

-- Only authenticated photographers can upload
create policy "Authenticated uploads" on photos for insert 
with check (auth.uid() = photographer_id);

-- Only photo owner can delete
create policy "Owner can delete" on photos for delete 
using (auth.uid() = photographer_id);
```

5. Deploy the Edge Function

Deploy the function to Supabase and set your R2 credentials as environment secrets:
```bash
supabase functions deploy generate-upload-url --project-ref your-project-ref
supabase secrets set R2_ACCESS_KEY_ID=your_key --project-ref your-project-ref
supabase secrets set R2_SECRET_ACCESS_KEY=your_key --project-ref your-project-ref
```

6. Start the development server
```bash
npm run dev
```