import { createServiceClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TriggerButtons } from "./trigger-buttons";

interface CronLog {
  id: string;
  job_name: string;
  status: "success" | "error";
  duration_ms: number;
  stats: Record<string, unknown>;
  error_message: string | null;
  started_at: string;
}

const JOB_LABELS: Record<string, string> = {
  "poll-classify": "Poll & Classify",
  "generate-drafts": "Generate Drafts",
  "send-emails": "Send Emails",
};

const JOB_COLORS: Record<string, string> = {
  "poll-classify": "bg-blue-100 text-blue-800",
  "generate-drafts": "bg-purple-100 text-purple-800",
  "send-emails": "bg-green-100 text-green-800",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function summarize(log: CronLog): string {
  const s = log.stats;
  switch (log.job_name) {
    case "poll-classify":
      return `${s.emails_processed ?? 0} processed, ${s.emails_matched ?? 0} matched`;
    case "generate-drafts":
      return `${s.drafts_generated ?? 0} drafted (${s.auto_approved ?? 0} auto, ${s.pending_review ?? 0} review)`;
    case "send-emails":
      return `${s.emails_sent ?? 0} sent`;
    default:
      return "";
  }
}

const TABS = [
  { key: "all", label: "All" },
  { key: "poll-classify", label: "Poll & Classify" },
  { key: "generate-drafts", label: "Generate Drafts" },
  { key: "send-emails", label: "Send Emails" },
];

export default async function CronLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>;
}) {
  const { job } = await searchParams;
  const supabase = createServiceClient();

  // Summary stats (last 24h)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentLogs } = await supabase
    .from("cron_logs")
    .select("*")
    .gte("started_at", since)
    .order("started_at", { ascending: false });

  const logs24h = (recentLogs ?? []) as CronLog[];

  const totalRuns = logs24h.length;
  const emailsProcessed = logs24h
    .filter((l) => l.job_name === "poll-classify")
    .reduce((sum, l) => sum + (Number(l.stats.emails_processed) || 0), 0);
  const emailsSent = logs24h
    .filter((l) => l.job_name === "send-emails")
    .reduce((sum, l) => sum + (Number(l.stats.emails_sent) || 0), 0);
  const errorCount = logs24h.filter((l) => l.status === "error").length;

  // Run history (filtered by job tab)
  let query = supabase
    .from("cron_logs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(100);

  if (job && job !== "all") {
    query = query.eq("job_name", job);
  }

  const { data: historyData } = await query;
  const history = (historyData ?? []) as CronLog[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cron Logs</h1>
        <TriggerButtons />
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Runs (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalRuns}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Emails Processed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{emailsProcessed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Emails Sent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{emailsSent}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${errorCount > 0 ? "text-red-600" : ""}`}>
              {errorCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <a
            key={tab.key}
            href={tab.key === "all" ? "/admin/cron-logs" : `/admin/cron-logs?job=${tab.key}`}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              (job ?? "all") === tab.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {/* Run History Table */}
      {history.length === 0 ? (
        <p className="text-muted-foreground">No cron runs recorded yet.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">Job</th>
                <th className="text-left px-4 py-3 font-medium">Duration</th>
                <th className="text-left px-4 py-3 font-medium">Summary</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {history.map((log) => (
                <tr key={log.id} className="group">
                  <td colSpan={5} className="p-0">
                    <details>
                      <summary className="grid grid-cols-[1fr_1fr_0.7fr_2fr_0.7fr] px-4 py-3 cursor-pointer hover:bg-muted/30 list-none [&::-webkit-details-marker]:hidden">
                        <span className="text-muted-foreground" title={new Date(log.started_at).toLocaleString()}>
                          {timeAgo(log.started_at)}
                        </span>
                        <span>
                          <Badge className={JOB_COLORS[log.job_name] ?? ""}>
                            {JOB_LABELS[log.job_name] ?? log.job_name}
                          </Badge>
                        </span>
                        <span>{formatDuration(log.duration_ms)}</span>
                        <span>{summarize(log)}</span>
                        <span>
                          <Badge className={log.status === "error" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}>
                            {log.status}
                          </Badge>
                        </span>
                      </summary>
                      <div className="px-4 pb-4 pt-2 bg-muted/20">
                        {log.error_message && (
                          <p className="text-sm text-red-600 mb-2">
                            Error: {log.error_message}
                          </p>
                        )}
                        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
                          {Object.entries(log.stats).map(([key, value]) => (
                            <div key={key} className="flex justify-between">
                              <dt className="text-muted-foreground">{key}</dt>
                              <dd className="font-mono">
                                {typeof value === "object" ? JSON.stringify(value) : String(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
