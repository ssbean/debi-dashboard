import { parseAddressList } from "email-addresses";
import { getLatestThreadMessage, sendEmail, getSignature } from "./gmail";
import { logger } from "./logger";
import type { Draft, Trigger } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

type SendableDraft = Omit<Draft, "trigger"> & {
  trigger: Pick<Trigger, "reply_in_thread"> | null;
};

interface ResolvedRecipients {
  to: readonly string[];
  cc: readonly string[];
}

function parseAddresses(header: string | null): string[] {
  if (!header) return [];
  const parsed = parseAddressList(header);
  if (!parsed) return [];
  return parsed
    .filter((a) => a.type === "mailbox" && a.address)
    .map((a) => (a as { address: string }).address);
}

function resolveReplyAllRecipients(
  latestFrom: string,
  latestTo: string,
  latestCc: string | null,
  latestReplyTo: string | null,
  ceoEmail: string,
): ResolvedRecipients {
  const fromAddrs = parseAddresses(latestFrom);
  const toAddrs = parseAddresses(latestTo);
  const ccAddrs = parseAddresses(latestCc);
  const replyToAddrs = parseAddresses(latestReplyTo);

  const self = ceoEmail.toLowerCase();
  const isSelf = (addr: string) => addr.toLowerCase() === self;

  // To = Reply-To (or From) + original To, minus self, deduplicated
  const rawTo = [
    ...(replyToAddrs.length ? replyToAddrs : fromAddrs),
    ...toAddrs,
  ].filter((addr) => !isSelf(addr));

  const seenTo = new Set<string>();
  const newTo = rawTo.filter((addr) => {
    const lower = addr.toLowerCase();
    if (seenTo.has(lower)) return false;
    seenTo.add(lower);
    return true;
  });

  // Cc = original Cc, minus self, minus anyone already in To
  const newCc = ccAddrs.filter(
    (addr) => !isSelf(addr) && !seenTo.has(addr.toLowerCase()),
  );

  return { to: newTo, cc: newCc };
}

/**
 * Resolves recipients and sends a draft email.
 * For reply-in-thread triggers, fetches the latest thread message and does reply-all.
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

  let to: string;
  let cc: string | null = null;
  let inReplyTo: string | null = null;

  if (threadId) {
    // Reply-all: fetch latest thread message and resolve recipients
    const latestMessage = await getLatestThreadMessage(threadId);

    if (latestMessage) {
      inReplyTo = latestMessage.messageId;

      const resolved = resolveReplyAllRecipients(
        latestMessage.from,
        latestMessage.to,
        latestMessage.cc,
        latestMessage.replyTo,
        ceoEmail,
      );

      if (resolved.to.length > 0) {
        to = resolved.to.join(", ");
        cc = resolved.cc.length > 0 ? resolved.cc.join(", ") : null;
        logger.info(
          `Reply-all resolved: To=[${to}] CC=[${cc ?? "none"}]`,
          "send-draft",
        );
      } else {
        // All recipients stripped (unlikely) — fall back
        logger.warn(
          "Reply-all resolved to zero recipients, falling back to trigger_email_from",
          "send-draft",
        );
        to = draft.trigger_email_from;
        cc = draft.trigger_email_cc;
      }
    } else {
      // Thread not found — fall back to stored recipients
      logger.warn(
        `Thread ${threadId} not found, falling back to stored recipients`,
        "send-draft",
      );
      to = draft.trigger_email_from;
      cc = draft.trigger_email_cc;
    }
  } else {
    // Standalone send: use trigger_email_from (not recipient_email, which may be LLM-extracted)
    to = draft.trigger_email_from;
    cc = draft.trigger_email_cc;
  }

  if (!draft.subject || !draft.body) {
    throw new Error(`Draft ${draft.id} missing required fields (subject, body)`);
  }

  await sendEmail(
    to,
    draft.subject,
    draft.body,
    threadId,
    inReplyTo,
    cc,
    options.redirectTo,
    options.signature,
  );

  // Persist actual recipients for audit trail
  const { error: auditError } = await supabase
    .from("drafts")
    .update({
      sent_to: to,
      sent_cc: cc,
    })
    .eq("id", draft.id);

  if (auditError) {
    logger.warn(
      `Failed to persist sent_to/sent_cc for draft ${draft.id}: ${auditError.message}`,
      "send-draft",
    );
  }
}
