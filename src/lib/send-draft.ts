import { parseAddressList } from "email-addresses";
import { getThreadParticipants, sendEmail } from "./gmail";
import { logger } from "./logger";
import type { Draft, Trigger } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

type SendableDraft = Omit<Draft, "trigger"> & {
  trigger: Pick<Trigger, "reply_in_thread"> | null;
};

function parseAddresses(header: string | null): string[] {
  if (!header) return [];
  const parsed = parseAddressList(header);
  if (!parsed) return [];
  return parsed
    .filter((a) => a.type === "mailbox" && a.address)
    .map((a) => (a as { address: string }).address);
}

/**
 * Resolves recipients and sends a draft email.
 * All recipients are placed in BCC; the To: header is set to the CEO's own email.
 * For reply-in-thread triggers, collects participants from ALL thread messages
 * so that early repliers who dropped off the CC chain are still included.
 * Persists sent_to/sent_bcc to the draft row for audit purposes.
 * Throws on failure — callers implement their own retry/error policy.
 */
export async function sendDraft(
  draft: SendableDraft,
  supabase: SupabaseClient,
  options: {
    redirectTo?: string | null;
    signature?: string | null;
  } = {},
): Promise<void> {
  const ceoEmail = process.env.CEO_EMAIL;
  if (!ceoEmail) throw new Error("CEO_EMAIL environment variable is required");

  const threadId =
    draft.trigger?.reply_in_thread ? draft.gmail_thread_id : null;

  let bccRecipients: string[];
  let inReplyTo: string | null = null;

  if (threadId) {
    // Reply-in-thread: collect all participants across the entire thread
    const thread = await getThreadParticipants(threadId, ceoEmail);

    if (thread && thread.allParticipants.length > 0) {
      inReplyTo = thread.latestMessageId;
      bccRecipients = thread.allParticipants;

      logger.info(
        `BCC recipients resolved from thread: [${bccRecipients.join(", ")}]`,
        "send-draft",
      );
    } else {
      // Thread not found or empty — fall back to stored recipients
      logger.warn(
        `Thread ${threadId} returned no participants, falling back to stored recipients`,
        "send-draft",
      );
      bccRecipients = [
        ...parseAddresses(draft.trigger_email_from),
        ...parseAddresses(draft.trigger_email_to),
        ...parseAddresses(draft.trigger_email_cc),
      ];
    }
  } else {
    // Standalone send: BCC all original recipients
    bccRecipients = [
      ...parseAddresses(draft.trigger_email_from),
      ...parseAddresses(draft.trigger_email_to),
      ...parseAddresses(draft.trigger_email_cc),
    ];
  }

  // Deduplicate and exclude the CEO (already in To:)
  const self = ceoEmail.toLowerCase();
  const seen = new Set<string>();
  bccRecipients = bccRecipients.filter((addr) => {
    const lower = addr.toLowerCase();
    if (lower === self || seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });

  if (!draft.subject || !draft.body) {
    throw new Error(`Draft ${draft.id} missing required fields (subject, body)`);
  }

  const bcc = bccRecipients.join(", ") || null;

  await sendEmail({
    to: ceoEmail,
    subject: draft.subject,
    body: draft.body,
    threadId,
    inReplyTo,
    bcc,
    redirectTo: options.redirectTo,
    signature: options.signature,
  });

  // Persist actual recipients for audit trail
  const { error: auditError } = await supabase
    .from("drafts")
    .update({
      sent_to: ceoEmail,
      sent_cc: null,
      sent_bcc: bcc,
    })
    .eq("id", draft.id);

  if (auditError) {
    logger.warn(
      `Failed to persist sent recipients for draft ${draft.id}: ${auditError.message}`,
      "send-draft",
    );
  }
}
