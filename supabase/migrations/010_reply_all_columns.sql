-- Capture original To header from trigger email (for UI display)
ALTER TABLE drafts ADD COLUMN trigger_email_to text;

-- Audit trail: actual recipients at send time
ALTER TABLE drafts ADD COLUMN sent_to text;
ALTER TABLE drafts ADD COLUMN sent_cc text;
