import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail, getLatestThreadMessageId } from "@/lib/gmail";
import { logger } from "@/lib/logger";
import { logCronRun } from "@/lib/cron-logger";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = new Date();

  if (process.env.DEV_MODE === "true") {
    logger.info("DEV_MODE active — skipping email send", "send-emails");
    await logCronRun(supabase, "send-emails", startedAt, "success", {
      emails_sent: 0,
      emails_failed: 0,
      errors: 0,
    });
    return NextResponse.json({ message: "DEV_MODE active, no emails sent" });
  }

  try {
    const { data: settings } = await supabase
      .from("settings")
      .select("ceo_email")
      .eq("id", 1)
      .maybeSingle();

    if (!settings) {
      return NextResponse.json({ error: "Settings not configured" }, { status: 500 });
    }

    // Fetch drafts ready to send
    const { data: drafts } = await supabase
      .from("drafts")
      .select("*, trigger:triggers(reply_in_thread)")
      .in("status", ["approved", "auto_approved"])
      .not("scheduled_send_at", "is", null)
      .lte("scheduled_send_at", new Date().toISOString())
      .is("sent_at", null)
      .limit(10);

    if (!drafts?.length) {
      await logCronRun(supabase, "send-emails", startedAt, "success", {
        emails_sent: 0,
        emails_failed: 0,
        errors: 0,
      });
      return NextResponse.json({ message: "No emails to send" });
    }

    let sent = 0;
    let failed = 0;

    for (const draft of drafts) {
      try {
        if (!draft.recipient_email || !draft.subject || !draft.body) {
          logger.warn(`Draft ${draft.id} missing required send fields`, "send-emails");
          continue;
        }

        const threadId =
          draft.trigger?.reply_in_thread ? draft.gmail_thread_id : null;

        // Fetch latest message ID for proper threading headers
        let inReplyTo: string | null = null;
        if (threadId) {
          inReplyTo = await getLatestThreadMessageId(settings.ceo_email, threadId);
        }

        await sendEmail(
          settings.ceo_email,
          draft.recipient_email,
          draft.subject,
          draft.body,
          threadId,
          inReplyTo,
          draft.trigger_email_cc,
        );

        await supabase
          .from("drafts")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", draft.id);

        sent++;
      } catch (error) {
        const attempts = (draft.send_attempts ?? 0) + 1;
        const newStatus = attempts >= 3 ? "failed" : draft.status;

        await supabase
          .from("drafts")
          .update({
            send_attempts: attempts,
            send_error: String(error),
            status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", draft.id);

        failed++;
        logger.error(`Failed to send draft ${draft.id}`, "send-emails", {
          error: String(error),
          attempt: attempts,
        });
      }
    }

    const stats = {
      emails_sent: sent,
      emails_failed: failed,
      errors: failed,
    };

    logger.info("Send-emails completed", "send-emails", { sent, failed });
    await logCronRun(supabase, "send-emails", startedAt, "success", stats);

    return NextResponse.json({ sent, failed });
  } catch (error) {
    logger.error("Send-emails failed", "send-emails", { error: String(error) });
    await logCronRun(supabase, "send-emails", startedAt, "error", { errors: 1 }, String(error));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
