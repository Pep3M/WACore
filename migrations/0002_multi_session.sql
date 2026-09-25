-- Multi-session support: add tenant columns to wacore_sessions
ALTER TABLE "wacore_sessions"
  ADD COLUMN IF NOT EXISTS "account_id" text,
  ADD COLUMN IF NOT EXISTS "user_id" text,
  ADD COLUMN IF NOT EXISTS "display_name" text,
  ADD COLUMN IF NOT EXISTS "phone_number" text,
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "wacore_sessions_account_idx" ON "wacore_sessions"("account_id");
CREATE INDEX IF NOT EXISTS "wacore_sessions_owner_idx" ON "wacore_sessions"("account_id", "user_id");
