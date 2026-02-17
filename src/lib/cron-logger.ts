import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";

export async function logCronRun(
  supabase: SupabaseClient,
  jobName: string,
  startedAt: Date,
  status: "success" | "error",
  stats: Record<string, unknown>,
  errorMessage?: string
): Promise<void> {
  try {
    const durationMs = Date.now() - startedAt.getTime();
    await supabase.from("cron_logs").insert({
      job_name: jobName,
      status,
      duration_ms: durationMs,
      stats,
      error_message: errorMessage,
      started_at: startedAt.toISOString(),
    });
  } catch (err) {
    logger.error("Failed to write cron log", "cron-logger", {
      jobName,
      error: String(err),
    });
  }
}
