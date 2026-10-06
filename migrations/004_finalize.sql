-- Automatic absent finalization: one row per finalized date (also the idempotency lock) + go-live boundary. Safe to re-run.
CREATE TABLE IF NOT EXISTS finalizations(date DATE PRIMARY KEY,ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),source TEXT NOT NULL,marked INT NOT NULL DEFAULT 0);
INSERT INTO settings(k,v) VALUES('auto_absent_from',to_char(now() AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD')) ON CONFLICT(k) DO NOTHING;
