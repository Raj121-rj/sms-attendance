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
On Time until 07:20 · Late after that (late minutes saved). Half Day = approved 0.5 leave (2 = 1, 4 = 2). Absent is only set by Admin; missing IN/OUT is shown as "अभी दर्ज नहीं" / "OUT दर्ज नहीं". Sundays and calendar holidays are never absences.

## Upgrading an existing database
Just deploy: `schema.sql` migrates in place (adds columns/tables, keeps all attendance). Reprint the QR codes: the app now has separate **IN** and **OUT** QR codes (Admin → QR Code).

## Not included yet
Monthly calendar view, punctuality streaks, academic sessions, staff profile/photo edit, attendance reminders beyond the OUT notice, real PDF file (use PDF / प्रिंट), PWA install and push.