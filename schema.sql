CREATE TABLE IF NOT EXISTS users(
 id SERIAL PRIMARY KEY, staff_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, mobile TEXT,
 username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'teacher' CHECK(role IN('admin','teacher')),
 active BOOLEAN NOT NULL DEFAULT true, must_change BOOLEAN NOT NULL DEFAULT true,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS attendance(
 id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id), date DATE NOT NULL,
 in_time TIMESTAMPTZ, out_time TIMESTAMPTZ, status TEXT,
 in_lat DOUBLE PRECISION, in_lng DOUBLE PRECISION, in_acc REAL, in_qr BOOLEAN NOT NULL DEFAULT false,
 out_lat DOUBLE PRECISION, out_lng DOUBLE PRECISION, out_acc REAL, out_qr BOOLEAN NOT NULL DEFAULT false,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(user_id,date));
CREATE INDEX IF NOT EXISTS attendance_date_idx ON attendance(date);
CREATE TABLE IF NOT EXISTS notifications(id SERIAL PRIMARY KEY, msg TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_logs(id SERIAL PRIMARY KEY, user_id INT, action TEXT NOT NULL, detail TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- v2 migration (idempotent, keeps existing data)
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_min INT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id INT;
UPDATE attendance SET status='On Time' WHERE status='Present';
CREATE TABLE IF NOT EXISTS leaves(id SERIAL PRIMARY KEY,user_id INT NOT NULL REFERENCES users(id),from_date DATE NOT NULL,to_date DATE NOT NULL,kind TEXT NOT NULL CHECK(kind IN('full','half')),reason TEXT NOT NULL,note TEXT,status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN('Pending','Approved','Rejected')),decided_by INT,decided_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS corrections(id SERIAL PRIMARY KEY,user_id INT NOT NULL REFERENCES users(id),date DATE NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN('Pending','Approved','Rejected')),decided_by INT,decided_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS attendance_changes(id SERIAL PRIMARY KEY,attendance_id INT,user_id INT NOT NULL,date DATE NOT NULL,original JSONB,changed JSONB,reason TEXT NOT NULL,admin_id INT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS holidays(date DATE PRIMARY KEY,name TEXT NOT NULL,working BOOLEAN NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS leaves_user_idx ON leaves(user_id,from_date);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS half_reason TEXT;
