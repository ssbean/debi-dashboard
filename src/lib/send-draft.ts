import { parseAddressList } from "email-addresses";
import { getLatestThreadMessage, muteThread, sendEmail } from "./gmail";
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
 * For reply-in-thread triggers, sends reply-all using the latest thread message's
 * To/CC headers, then mutes the thread to prevent inbox flooding.
 * For standalone sends, sends to the original sender only.
 * Persists sent_to/sent_cc to the draft row for audit purposes.
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

  let recipientTo: string;
  let recipientCc: string | null = null;
  let inReplyTo: string | null = null;

  if (threadId) {
    // Reply-in-thread: standard reply-all using latest message headers
    const latest = await getLatestThreadMessage(threadId);

    if (latest) {
      // Standard reply-all: From → To, keep CC, exclude CEO
      const replyTo = latest.replyTo || latest.from;
      const toAddresses = replyTo ? [replyTo] : [];
      const ccAddresses = [
        ...parseAddresses(latest.to),
        ...parseAddresses(latest.cc),
      ].filter((addr) => addr.toLowerCase() !== ceoEmail.toLowerCase());

      recipientTo = toAddresses.join(", ");
      recipientCc = ccAddresses.join(", ") || null;
      inReplyTo = latest.messageId;

      logger.info(
        `Reply-all recipients resolved from thread: To=[${recipientTo}] CC=[${recipientCc ?? "none"}]`,
        "send-draft",
      );
    } else {
      // Thread not found or empty — fall back to stored recipients
      logger.warn(
        `Thread ${threadId} not found, falling back to stored recipients`,
        "send-draft",
      );
      recipientTo = draft.trigger_email_from;
      recipientCc =
        [draft.trigger_email_to, draft.trigger_email_cc]
          .filter(Boolean)
          .join(", ") || null;
    }
  } else {
    // Standalone send: to original sender only
    recipientTo = draft.recipient_email ?? draft.trigger_email_from;
  }

  if (!draft.subject || !draft.body) {
    throw new Error(`Draft ${draft.id} missing required fields (subject, body)`);
  }

  await sendEmail({
    to: recipientTo,
    subject: draft.subject,
    body: draft.body,
    threadId,
    inReplyTo,
    cc: recipientCc,
    redirectTo: options.redirectTo,
    signature: options.signature,
  });

  // Mute the thread to prevent inbox flooding from replies
  // Fire-and-forget: don't block the send pipeline on a best-effort operation
  if (threadId && !options.redirectTo) {
    muteThread(threadId).catch((error) => {
      logger.warn(
        `Failed to mute thread ${threadId}: ${String(error)}`,
        "send-draft",
      );
    });
  }

  // Persist actual recipients for audit trail
  const { error: auditError } = await supabase
    .from("drafts")
    .update({
      sent_to: recipientTo,
      sent_cc: recipientCc,
      sent_bcc: null,
    })
    .eq("id", draft.id);

  if (auditError) {
    logger.warn(
      `Failed to persist sent recipients for draft ${draft.id}: ${auditError.message}`,
      "send-draft",
    );
  }
}
