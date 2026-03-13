import { parseAddressList } from "email-addresses";
import { getLatestThreadMessage, sendEmail } from "./gmail";
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

/** Collect all recipients from a thread message, excluding the CEO, deduplicated. */
function resolveRecipients(
  latestFrom: string,
  latestTo: string,
  latestCc: string | null,
  latestReplyTo: string | null,
  ceoEmail: string,
): string[] {
  const fromAddrs = parseAddresses(latestFrom);
  const toAddrs = parseAddresses(latestTo);
  const ccAddrs = parseAddresses(latestCc);
  const replyToAddrs = parseAddresses(latestReplyTo);

  const self = ceoEmail.toLowerCase();
  const isSelf = (addr: string) => addr.toLowerCase() === self;

  const all = [
    ...(replyToAddrs.length ? replyToAddrs : fromAddrs),
    ...toAddrs,
    ...ccAddrs,
  ].filter((addr) => !isSelf(addr));

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  return all.filter((addr) => {
    const lower = addr.toLowerCase();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}

/**
 * Resolves recipients and sends a draft email.
 * All recipients are placed in BCC; the To: header is set to the CEO's own email.
 * For reply-in-thread triggers, fetches the latest thread message to collect recipients.
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
    // Reply-in-thread: fetch latest thread message and resolve all recipients
    const latestMessage = await getLatestThreadMessage(threadId);

    if (latestMessage) {
      inReplyTo = latestMessage.messageId;

      bccRecipients = resolveRecipients(
        latestMessage.from,
        latestMessage.to,
        latestMessage.cc,
        latestMessage.replyTo,
        ceoEmail,
      );

      if (bccRecipients.length === 0) {
        logger.warn(
          "Resolved to zero recipients, falling back to trigger_email_from",
          "send-draft",
        );
        bccRecipients = parseAddresses(draft.trigger_email_from);
      } else {
        logger.info(
          `BCC recipients resolved: [${bccRecipients.join(", ")}]`,
          "send-draft",
        );
      }
    } else {
      // Thread not found — fall back to stored recipients
      logger.warn(
        `Thread ${threadId} not found, falling back to stored recipients`,
        "send-draft",
      );
      bccRecipients = [
        ...parseAddresses(draft.trigger_email_from),
        ...parseAddresses(draft.trigger_email_cc),
      ];
    }
  } else {
    // Standalone send: BCC the original sender (+ CC if any)
    bccRecipients = [
      ...parseAddresses(draft.trigger_email_from),
      ...parseAddresses(draft.trigger_email_cc),
    ];
  }

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
