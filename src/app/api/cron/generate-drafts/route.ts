import { NextRequest, NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { createServiceClient } from "@/lib/supabase/server";
import { draftEmail } from "@/lib/claude";
import { calculateSendTime } from "@/lib/scheduler";
import { logger } from "@/lib/logger";
import { logCronRun } from "@/lib/cron-logger";
import type { Settings, Trigger, StyleExample } from "@/lib/types";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedAt = new Date();

  try {
    // Fetch settings
    const { data: settings } = await supabase
      .from("settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (!settings) {
      return NextResponse.json({ error: "Settings not configured" }, { status: 500 });
    }

    // Pick up drafts needing generation
    const { data: drafts } = await supabase
      .from("drafts")
      .select("*, trigger:triggers(*)")
      .eq("status", "needs_drafting")
      .limit(5);

    if (!drafts?.length) {
      await logCronRun(supabase, "generate-drafts", startedAt, "success", {
        drafts_generated: 0,
        auto_approved: 0,
        pending_review: 0,
        queue_remaining: 0,
        avg_confidence: 0,
        errors: 0,
      });
      return NextResponse.json({ message: "No drafts to generate" });
    }

    // Get existing scheduled times for spacing
    const { data: scheduledDrafts } = await supabase
      .from("drafts")
      .select("scheduled_send_at")
      .in("status", ["approved", "auto_approved", "pending_review"])
      .not("scheduled_send_at", "is", null);

    const existingTimes = (scheduledDrafts ?? [])
      .map((d: { scheduled_send_at: string | null }) => d.scheduled_send_at)
      .filter((t): t is string => t !== null)
      .map((t) => new Date(t));

    let generated = 0;
    let autoApproved = 0;
    let pendingReview = 0;
    let errors = 0;
    let totalConfidence = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const draft of drafts) {
      try {
        const trigger = draft.trigger as Trigger;

        // Fetch style examples
        const { data: examples } = await supabase
          .from("style_examples")
          .select("*")
          .eq("trigger_id", draft.trigger_id)
          .order("created_at", { ascending: false })
          .limit(5);

        const { result, usage } = await draftEmail(
          trigger,
          draft.trigger_email_from,
          draft.trigger_email_subject,
          draft.trigger_email_body_snippet ?? "",
          draft.recipient_name,
          draft.recipient_email,
          (examples ?? []) as StyleExample[],
        );

        totalInputTokens += usage.input_tokens;
        totalOutputTokens += usage.output_tokens;

        // Calculate send time
        const sendTime = calculateSendTime(
          new Date(draft.created_at),
          settings as Settings,
          existingTimes,
        );
        existingTimes.push(sendTime);

        // Determine status based on confidence and auto-approval
        const threshold = settings.confidence_threshold as number;
        const confidence = draft.confidence_score as number;
        const borderlineBuffer = 5;
        const hasRecipient = !!draft.recipient_email;

        let newStatus: string;
        if (
          confidence >= threshold &&
          confidence >= threshold + borderlineBuffer &&
          hasRecipient
        ) {
          newStatus = "auto_approved";
          autoApproved++;
        } else {
          newStatus = "pending_review";
          pendingReview++;
        }

        totalConfidence += confidence;

        await supabase
          .from("drafts")
          .update({
            subject: result.subject,
            body: result.body,
            original_body: result.body,
            status: newStatus,
            scheduled_send_at: sendTime.toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", draft.id);

        generated++;
      } catch (error) {
        errors++;
        logger.error(`Failed to generate draft ${draft.id}`, "generate-drafts", {
          error: String(error),
        });
      }
    }

    // Query remaining needs_drafting count
    const { count: queueRemaining } = await supabase
      .from("drafts")
      .select("*", { count: "exact", head: true })
      .eq("status", "needs_drafting");

    const avgConfidence = generated > 0 ? Math.round(totalConfidence / generated) : 0;

    const stats = {
      drafts_generated: generated,
      auto_approved: autoApproved,
      pending_review: pendingReview,
      queue_remaining: queueRemaining ?? 0,
      avg_confidence: avgConfidence,
      errors,
      model: "claude-sonnet-4-5-20250929",
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    };

    logger.info("Generate-drafts completed", "generate-drafts", { generated, errors });
    await logCronRun(supabase, "generate-drafts", startedAt, "success", stats);

    return NextResponse.json({ generated, errors });
  } catch (error) {
    logger.error("Generate-drafts failed", "generate-drafts", { error: String(error) });
    await logCronRun(supabase, "generate-drafts", startedAt, "error", { errors: 1 }, String(error));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
