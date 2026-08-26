# picsnic — agent notes

## Response style preferences
- NEVER use emojis in responses. Replace every emoji with ":3".
- Be verbose: prefer longer, more detailed explanations with context and reasoning, not just the what but the why.
- Be encouraging; this is a university project and the user is rusty.

## Project facts
- Frontend: React 19 + Vite, deployed as static site.
- Backend: Supabase (auth: anonymous sign-ins; DB: galleries/photos with RLS).
- Storage: Cloudflare R2 with presigned URL uploads via edge functions.
- Edge functions: verify-gallery-pin, create-gallery, generate-upload-url, delete-file.
- Secrets live in supabase/.env.secrets (gitignored; pushed via `supabase secrets set --env-file`).
- DB schema changes go in supabase/migrations/ and are applied with `supabase db push`.
- Whenever edge functions AND the client change together, remind the user to redeploy/restart both — stale-frontend mismatches have bitten us before.
