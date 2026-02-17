import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchNewEmails } from "@/lib/gmail";
import { classifyEmail } from "@/lib/claude";
import { logger } from "@/lib/logger";
import type { Trigger } from "@/lib/types";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let step = "init";
  const supabase = createServiceClient();
  const startTime = Date.now();

  try {
    step = "settings";
    // Fetch settings
    const { data: settings, error: settingsErr } = await supabase
      .from("settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (settingsErr) {
      return NextResponse.json({ error: "settings query failed", detail: settingsErr.message }, { status: 500 });
    }

    if (!settings) {
      return NextResponse.json({ error: "Settings not configured" }, { status: 500 });
    }

    step = "triggers";
    // Fetch enabled triggers
    const { data: triggers, error: triggersErr } = await supabase
      .from("triggers")
      .select("*")
      .eq("enabled", true)
      .is("deleted_at", null)
      .order("sort_order");

    if (triggersErr) {
      return NextResponse.json({ error: "triggers query failed", detail: triggersErr.message }, { status: 500 });
    }

    if (!triggers?.length) {
      return NextResponse.json({ message: "No active triggers" });
    }

    step = "gmail";
    // Fetch emails from last 10 minutes (overlap to avoid missing)
    const since = new Date(Date.now() - 10 * 60 * 1000);
    const domains = settings.company_domains.split(",").map((d: string) => d.trim());
    const emails = await fetchNewEmails(settings.ceo_email, since, domains);

    let processed = 0;
    let matched = 0;
    let errors = 0;

    // Process in batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < Math.min(emails.length, 20); i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (email) => {
          try {
            // Check dedup
            const { data: existing } = await supabase
              .from("processed_emails")
              .select("gmail_message_id")
              .eq("gmail_message_id", email.messageId)
              .maybeSingle();

            if (existing) return;

            // Classify
            const result = await classifyEmail(
              email.from,
              email.subject,
              email.body,
              triggers as Trigger[],
            );

            // Insert processed_emails
            await supabase.from("processed_emails").insert({
              gmail_message_id: email.messageId,
              matched: result.matched,
            });

            processed++;

            if (result.matched && result.trigger_id) {
              // Insert draft with needs_drafting status
              await supabase.from("drafts").insert({
                trigger_id: result.trigger_id,
                gmail_message_id: email.messageId,
                gmail_thread_id: email.threadId,
                trigger_email_from: email.from,
                trigger_email_subject: email.subject,
                trigger_email_body_snippet: email.body.slice(0, 500),
                recipient_email: result.recipient_email,
                recipient_name: result.recipient_name,
                confidence_score: result.confidence,
                status: "needs_drafting",
              });
              matched++;
            }
          } catch (error) {
            errors++;
            logger.error(`Failed to process email ${email.messageId}`, "poll-classify", {
              error: String(error),
            });
          }
        }),
      );
    }

    const duration = Date.now() - startTime;
    logger.info("Poll-classify completed", "poll-classify", {
      emailsScanned: emails.length,
      processed,
      matched,
      errors,
      durationMs: duration,
    });

    return NextResponse.json({ emailsScanned: emails.length, processed, matched, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message.slice(0, 500), step }, { status: 500 });
  }
}
