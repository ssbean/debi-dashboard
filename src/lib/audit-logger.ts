import { logger } from "./logger";
import type { SupabaseClient } from "@supabase/supabase-js";

interface AuditEventInput {
  action: string;
  actorEmail: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget audit event insert. Never throws. */
export async function logAuditEvent(
  supabase: SupabaseClient,
  event: AuditEventInput,
): Promise<void> {
  try {
    await supabase.from("audit_events").insert({
      action: event.action,
      actor_email: event.actorEmail,
      entity_type: event.entityType ?? null,
      entity_id: event.entityId ?? null,
      metadata: event.metadata ?? {},
    });
  } catch (error) {
    logger.error("Failed to log audit event", "audit", {
      action: event.action,
      error: String(error),
    });
  }
}
