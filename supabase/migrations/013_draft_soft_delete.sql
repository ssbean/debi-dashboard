-- Add soft-delete to drafts (triggers already have this pattern)
ALTER TABLE drafts ADD COLUMN deleted_at timestamptz;

-- Partial index: most queries only want non-deleted drafts
CREATE INDEX idx_drafts_deleted_at ON drafts (deleted_at) WHERE deleted_at IS NULL;
