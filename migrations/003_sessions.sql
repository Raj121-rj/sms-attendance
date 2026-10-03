-- Academic sessions. Runs as one transaction and is safe to re-run. Existing attendance is linked by date; nothing is deleted.
CREATE TABLE IF NOT EXISTS sessions(id SERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL,start_date DATE NOT NULL,end_date DATE NOT NULL,active BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),CHECK(end_date>start_date));
CREATE UNIQUE INDEX IF NOT EXISTS one_active_session ON sessions(active) WHERE active;
INSERT INTO sessions(name,start_date,end_date,active) SELECT '2026–27','2026-04-01'::date,'2027-03-31'::date,true WHERE NOT EXISTS(SELECT 1 FROM sessions);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_id INT REFERENCES sessions(id);
CREATE OR REPLACE FUNCTION att_session() RETURNS trigger AS $$ BEGIN IF NEW.session_id IS NULL THEN SELECT id INTO NEW.session_id FROM sessions WHERE NEW.date BETWEEN start_date AND end_date LIMIT 1; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS att_session_trg ON attendance;
CREATE TRIGGER att_session_trg BEFORE INSERT ON attendance FOR EACH ROW EXECUTE FUNCTION att_session();
UPDATE attendance a SET session_id=s.id FROM sessions s WHERE a.session_id IS NULL AND a.date BETWEEN s.start_date AND s.end_date;
CREATE INDEX IF NOT EXISTS attendance_session_idx ON attendance(session_id);
