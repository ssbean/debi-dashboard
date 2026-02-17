ALTER TABLE triggers
  ADD COLUMN match_mode text NOT NULL DEFAULT 'llm'
    CHECK (match_mode IN ('llm', 'gmail_filter')),
  ADD COLUMN gmail_filter_query text
    CHECK (gmail_filter_query IS NULL OR (length(gmail_filter_query) BETWEEN 1 AND 500)),
  ADD COLUMN created_by_email text,
  ADD COLUMN updated_by_email text;

ALTER TABLE triggers
  ADD CONSTRAINT check_gmail_filter_query
  CHECK (
    (match_mode = 'llm')
    OR
    (match_mode = 'gmail_filter' AND gmail_filter_query IS NOT NULL)
  );
