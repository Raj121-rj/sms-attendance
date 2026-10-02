# Staff Attendance — S.M.S. Jain Public Sr. Sec. School, Momasar
Node + Express + PostgreSQL. A teacher must be logged in, inside the GPS radius, and scan the school's permanent QR. The database clock (IST) is the only time source.

## Run locally
1. Install Node 18+. Get a free Postgres URL (Neon, or Supabase "Session pooler" string).
2. `cp .env.example .env` and fill DATABASE_URL and JWT_SECRET.
3. `npm install && npm start` → http://localhost:3000 (tables and demo data are created automatically from `schema.sql`).
GPS and camera need HTTPS on phones, so test attendance on the deployed site.

## Deploy free (₹0)
Database: Neon or Supabase free tier. App: Render → New Web Service → connect your GitHub repo → Build `npm install`, Start `npm start`, Free plan → add env vars DATABASE_URL, JWT_SECRET, NODE_ENV=production.
Free-tier notes: Render free sleeps after ~15 min idle (first open takes ~50 s). Supabase free pauses after a week of no use.

## First-time setup
Demo logins (passwords MUST be changed; the app forces this at first login):
- admin / Admin@123
- sunil, manoj, jagdish, kuldeep, lalchand / Teacher@123

1. Admin → Settings → stand inside the school → "Use my current location" → Save.
2. Admin → School QR → Print and fix it in the office. Use "Make a new QR" if it is ever compromised.
3. Teachers open the site on Android Chrome → menu → Add to Home screen.

## Rules (editable in Settings)
Present until 07:30 · Late until 09:00 · Half Day after that · Absent = no IN by school end.

## Not included yet
Correction requests, audit-log viewer (events are already saved in `audit_logs`), history filters, PDF/Excel export, PWA install and push.
