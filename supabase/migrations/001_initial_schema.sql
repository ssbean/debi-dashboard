-- Triggers table
CREATE TABLE triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  email_type text NOT NULL CHECK (email_type IN ('congratulatory', 'promotional', 'welcome')),
  reply_in_thread boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

CREATE UNIQUE INDEX idx_triggers_name_active ON triggers(name) WHERE deleted_at IS NULL;
CREATE INDEX idx_triggers_enabled ON triggers(enabled, sort_order) WHERE deleted_at IS NULL;

-- Style examples table
CREATE TABLE style_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id uuid NOT NULL REFERENCES triggers(id) ON DELETE RESTRICT,
  subject text NOT NULL,
  body text NOT NULL,
  source text NOT NULL CHECK (source IN ('seed', 'approved', 'edited')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_style_examples_trigger ON style_examples(trigger_id, created_at DESC);

-- Drafts table
CREATE TABLE drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id uuid NOT NULL REFERENCES triggers(id) ON DELETE RESTRICT,
  gmail_message_id text NOT NULL,
  gmail_thread_id text,
  trigger_email_from text NOT NULL,
  trigger_email_subject text NOT NULL,
  trigger_email_body_snippet text,
  recipient_email text,
  recipient_name text,
  subject text,
  body text,
  original_body text,
  confidence_score int NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  status text NOT NULL CHECK (status IN ('needs_drafting', 'pending_review', 'approved', 'auto_approved', 'sent', 'failed', 'rejected')) DEFAULT 'needs_drafting',
  send_attempts int NOT NULL DEFAULT 0 CHECK (send_attempts <= 3),
  scheduled_send_at timestamptz,
  sent_at timestamptz,
  send_error text,
  approved_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX idx_drafts_status_scheduled ON drafts(status, scheduled_send_at)
  WHERE status IN ('approved', 'auto_approved') AND sent_at IS NULL;
CREATE INDEX idx_drafts_created_at ON drafts(created_at DESC);
CREATE INDEX idx_drafts_trigger_id ON drafts(trigger_id);
CREATE INDEX idx_drafts_gmail_message_id ON drafts(gmail_message_id);

-- Settings table (singleton)
CREATE TABLE settings (
  id int PRIMARY KEY CHECK (id = 1),
  confidence_threshold int NOT NULL DEFAULT 100 CHECK (confidence_threshold >= 0 AND confidence_threshold <= 100),
  ceo_email text NOT NULL,
  ceo_timezone text NOT NULL DEFAULT 'America/New_York',
  company_domains text NOT NULL,
  business_hours_start text NOT NULL DEFAULT '09:00',
  business_hours_end text NOT NULL DEFAULT '17:00',
  holidays jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz
);

-- Seed singleton settings row
INSERT INTO settings (id, ceo_email, company_domains) VALUES (1, 'ceo@company.com', 'company.com');

-- Processed emails (deduplication)
CREATE TABLE processed_emails (
  gmail_message_id text PRIMARY KEY,
  matched boolean NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_processed_emails_processed_at ON processed_emails(processed_at DESC);
