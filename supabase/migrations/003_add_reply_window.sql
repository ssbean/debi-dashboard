ALTER TABLE triggers
  ADD COLUMN reply_window_min_hours numeric NOT NULL DEFAULT 4,
  ADD COLUMN reply_window_max_hours numeric NOT NULL DEFAULT 6;
