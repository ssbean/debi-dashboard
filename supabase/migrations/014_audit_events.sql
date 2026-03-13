CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  actor_email text NOT NULL,
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Primary query: chronological feed (admin activity page)
CREATE INDEX idx_audit_events_created_at ON audit_events (created_at DESC);

-- Filter by action category
CREATE INDEX idx_audit_events_action ON audit_events (action, created_at DESC);

-- Per-entity timeline (all events for a specific draft/trigger)
CREATE INDEX idx_audit_events_entity ON audit_events (entity_type, entity_id, created_at DESC);
