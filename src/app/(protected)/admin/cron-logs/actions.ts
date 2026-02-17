"use server";

import { auth } from "@/auth";

const CRON_JOBS = ["poll-classify", "generate-drafts", "send-emails"] as const;
type CronJob = (typeof CRON_JOBS)[number];

export async function triggerCronJob(job: CronJob): Promise<{ success: boolean; message: string }> {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Unauthorized" };
  }

  if (!CRON_JOBS.includes(job)) {
    return { success: false, message: "Invalid job name" };
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  try {
    const res = await fetch(`${baseUrl}/api/cron/${job}`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    const data = await res.json();
    return { success: res.ok, message: res.ok ? "Job triggered successfully" : (data.error ?? "Failed") };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}
