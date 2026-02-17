"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerCronJob } from "./actions";

const JOBS = [
  { key: "poll-classify" as const, label: "Poll & Classify" },
  { key: "generate-drafts" as const, label: "Generate Drafts" },
  { key: "send-emails" as const, label: "Send Emails" },
];

export function TriggerButtons() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleTrigger(job: "poll-classify" | "generate-drafts" | "send-emails") {
    startTransition(async () => {
      await triggerCronJob(job);
      router.refresh();
    });
  }

  return (
    <div className="flex gap-2">
      {JOBS.map((job) => (
        <button
          key={job.key}
          onClick={() => handleTrigger(job.key)}
          disabled={isPending}
          className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          {isPending ? "Running…" : `Run ${job.label}`}
        </button>
      ))}
    </div>
  );
}
