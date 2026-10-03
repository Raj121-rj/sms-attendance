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

## v3 additions
- **Calendar**: staff (dashboard) and admin (कैलेंडर tab, any staff, any month). Tap a date for details.
- **Punctuality streak** (personal only, rules documented in `logic.js`): +1 for an On Time IN; reset by Late, Absent, or a past working day with no IN; skipped: Sundays/holidays, approved full leave, half-day leave without IN, today before IN. Counted from the active session start.
- **Academic sessions** (Settings): `migrations/003_sessions.sql` creates 2026–27 and links existing attendance to it by date. Nothing is deleted; records outside every session stay unlinked. New sessions cannot overlap. Reports can be filtered by session.
- **PDF download**: `npm install` adds `pdfkit`. Hindi uses `fonts/FreeSans.ttf` (bundled); drop `NotoSansDevanagari-Regular.ttf` in `fonts/` for a nicer look. No font file = English labels.

## Tests
`npm test` runs unit tests for the streak, calendar codes, half-day = 0.5 leave and session rules (no database needed).

## Demo account (TEST ONLY)
`npm run demo:create` creates **demo.teacher / Demo@2026-test** (name "Demo Teacher (TEST)", ID DEMO001). `npm run demo:remove` deletes it with all its attendance, leaves and corrections. Never leave it in production.

## Before real staff use
1. Run `npm run demo:remove`. 2. Change the admin password and set a strong JWT_SECRET. 3. Settings: set school GPS and check session dates. 4. Print both QR codes. 5. Test IN, OUT, leave and PDF once with real phones on the deployed HTTPS site.

## v4 additions
- **Permanent delete** (Staff tab, only for *archived* staff, needs a confirmation dialog and typing DELETE). The login and profile (name, mobile, username, password) are erased; their attendance, leaves and corrections stay under "हटाया गया स्टाफ #id" so reports and the database stay consistent (no orphan rows). Archive and Restore are unchanged.
- **Automatic Absent after school end (1:30 PM)** for active staff with no attendance row, no approved leave/half-day, on a working day (not Sunday/holiday). IN without OUT is never Absent. One row per date in `finalizations` makes every run idempotent. Triggers: (1) external scheduler calling `POST /api/cron/finalize` (recommended), (2) any dashboard load after closing, (3) an in-process timer while the server is awake. It only covers dates from the go-live day (`auto_absent_from`) and at most 3 missed days. The admin dashboard shows whether today's run really happened.
- **Celebration screen** for On Time IN (CSS only, ~4 s, reduced-motion aware) with a best-effort Hindi voice. Late IN gets a calm message with the previous-attendance comparison and no animation. Browsers may block automatic speech; the visual greeting always works.

## Production step for automatic absent (required on free hosting)
Free web services sleep when idle, so also set `CRON_SECRET` (16+ random chars) and create a free scheduler job (cron-job.org or similar): **POST https://YOUR-APP/api/cron/finalize** with header `x-cron-secret: <secret>` every school day at **13:35 IST** (08:05 UTC). It wakes the server and finalizes the day.

## Not included yet
Staff profile/photo editing, PWA install and push.
