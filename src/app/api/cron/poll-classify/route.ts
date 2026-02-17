import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchNewEmails, fetchFilteredEmailIds } from "@/lib/gmail";
import { classifyEmail } from "@/lib/claude";
import { logger } from "@/lib/logger";
import { logCronRun } from "@/lib/cron-logger";
import type { Trigger } from "@/lib/types";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = new Date();

  try {
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

    // Fetch emails from last 70 minutes (overlap to avoid missing with hourly schedule)
    const since = new Date(Date.now() - 70 * 60 * 1000);
    const domains = settings.company_domains.split(",").map((d: string) => d.trim());

    // Split triggers by match mode
    const filterTriggers = (triggers as Trigger[]).filter(t => t.match_mode === "gmail_filter" && t.gmail_filter_query);
    const llmTriggers = (triggers as Trigger[]).filter(t => t.match_mode === "llm");

    let processed = 0;
    let matched = 0;
    let errors = 0;
    let duplicatesSkipped = 0;
    let totalConfidence = 0;
    let confidenceCount = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const byTrigger: Record<string, number> = {};

    // Filter phase: query Gmail API for each filter trigger to get matched message IDs
    const filterMatchedIds = new Map<string, Trigger>();
    for (const trigger of filterTriggers) {
      try {
        const matchedIds = await fetchFilteredEmailIds(
          settings.ceo_email,
          since,
          trigger.gmail_filter_query!,
        );
        for (const id of matchedIds) {
          if (!filterMatchedIds.has(id)) {
            filterMatchedIds.set(id, trigger);
          }
        }
      } catch (error) {
        errors++;
        logger.error(`Filter trigger "${trigger.name}" failed`, "poll-classify", {
          error: String(error),
          trigger_id: trigger.id,
        });
      }
    }

    // Fetch all candidate emails
    const emails = await fetchNewEmails(settings.ceo_email, since, domains);

    // Process in batches of 5
    const BATCH_SIZE = 5;
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
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

            if (existing) {
              duplicatesSkipped++;
              return;
            }

            // Check if this email was matched by a filter trigger
            const filterTrigger = filterMatchedIds.get(email.messageId);

            if (filterTrigger) {
              // Filter match: 100% confidence, no LLM call
              await supabase.from("processed_emails").insert({
                gmail_message_id: email.messageId,
                matched: true,
              });

              byTrigger[filterTrigger.name] = (byTrigger[filterTrigger.name] ?? 0) + 1;
              totalConfidence += 100;
              confidenceCount++;

              await supabase.from("drafts").insert({
                trigger_id: filterTrigger.id,
                gmail_message_id: email.messageId,
                gmail_thread_id: email.threadId,
                trigger_email_from: email.from,
                trigger_email_subject: email.subject,
                trigger_email_body_snippet: email.body.slice(0, 500),
                recipient_email: email.from,
                recipient_name: null,
                confidence_score: 100,
                status: "needs_drafting",
              });

              processed++;
              matched++;
              return;
            }

            // LLM phase: classify with remaining triggers
            if (llmTriggers.length === 0) {
              await supabase.from("processed_emails").insert({
                gmail_message_id: email.messageId,
                matched: false,
              });
              processed++;
              return;
            }

            const { result, usage } = await classifyEmail(
              email.from,
              email.subject,
              email.body,
              llmTriggers,
            );

            totalInputTokens += usage.input_tokens;
            totalOutputTokens += usage.output_tokens;

            await supabase.from("processed_emails").insert({
              gmail_message_id: email.messageId,
              matched: result.matched,
            });

            processed++;

            if (result.matched && result.trigger_id) {
              if (result.confidence !== undefined) {
                totalConfidence += result.confidence;
                confidenceCount++;
              }

              const triggerObj = llmTriggers.find(t => t.id === result.trigger_id);
              if (triggerObj) {
                byTrigger[triggerObj.name] = (byTrigger[triggerObj.name] ?? 0) + 1;
              }

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

    const avgConfidence = confidenceCount > 0 ? Math.round(totalConfidence / confidenceCount) : 0;
    const matchRate = processed > 0 ? Math.round((matched / processed) * 100) / 100 : 0;

    const stats = {
      emails_scanned: emails.length,
      duplicates_skipped: duplicatesSkipped,
      emails_processed: processed,
      emails_matched: matched,
      match_rate: matchRate,
      avg_confidence: avgConfidence,
      by_trigger: byTrigger,
      errors,
      model: "claude-haiku-4-5-20251001",
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    };

    logger.info("Poll-classify completed", "poll-classify", {
      emailsScanned: emails.length,
      processed,
      matched,
      errors,
      durationMs: Date.now() - startedAt.getTime(),
    });

    await logCronRun(supabase, "poll-classify", startedAt, "success", stats);

    return NextResponse.json({ emailsScanned: emails.length, processed, matched, errors });
  } catch (error) {
    logger.error("Poll-classify failed", "poll-classify", { error: String(error) });
    await logCronRun(supabase, "poll-classify", startedAt, "error", { errors: 1 }, String(error));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
