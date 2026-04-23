-- =============================================
-- AI Box Dashboard: MongoDB → Supabase Migration
-- Run this in your Supabase SQL Editor
-- =============================================

-- 1) USERS
CREATE TABLE IF NOT EXISTS users (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user'
                CHECK (role IN ('super-admin', 'admin', 'user')),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2) LOGS
CREATE TABLE IF NOT EXISTS logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  box_code        TEXT,
  source          TEXT,
  ip              TEXT,
  online_status   TEXT,
  service_name    TEXT,
  service_status  TEXT,
  type            TEXT
);

CREATE INDEX idx_logs_box_source_type ON logs (box_code, source, type);
CREATE INDEX idx_logs_timestamp       ON logs (timestamp DESC);
CREATE INDEX idx_logs_type            ON logs (type);

-- 3) BOX META
CREATE TABLE IF NOT EXISTS box_meta (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  box_code    TEXT NOT NULL UNIQUE,
  box_name    TEXT,
  device_name TEXT
);

-- 4) LOCATIONS
CREATE TABLE IF NOT EXISTS locations (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  box_code  TEXT NOT NULL UNIQUE,
  lat       DOUBLE PRECISION NOT NULL,
  lng       DOUBLE PRECISION NOT NULL
);

-- 5) SESSIONS (for express-session)
CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  sess    JSONB NOT NULL,
  expire  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_sessions_expire ON sessions (expire);
