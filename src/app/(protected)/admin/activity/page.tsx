import { createServiceClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format-date";
import type { AuditEvent } from "@/lib/types";
import Link from "next/link";

const ACTION_LABELS: Record<string, string> = {
  "draft.approve": "Approved draft",
  "draft.reject": "Rejected draft",
  "draft.regenerate": "Regenerated draft",
  "draft.send_now": "Sent draft (manual)",
  "draft.edit": "Edited draft",
  "draft.delete": "Deleted draft",
  "draft.unreject": "Un-rejected draft",
  "draft.auto_approve": "Auto-approved draft",
  "draft.send_success": "Sent draft",
  "draft.send_failure": "Failed to send draft",
  "trigger.create": "Created trigger",
  "trigger.update": "Updated trigger",
  "trigger.delete": "Deleted trigger",
  "settings.update": "Updated settings",
  "auth.login": "Logged in",
  "auth.login_denied": "Login denied",
};

const ACTION_COLORS: Record<string, string> = {
  "draft.approve": "bg-green-100 text-green-800",
  "draft.reject": "bg-red-100 text-red-800",
  "draft.regenerate": "bg-purple-100 text-purple-800",
  "draft.send_now": "bg-blue-100 text-blue-800",
  "draft.edit": "bg-yellow-100 text-yellow-800",
  "draft.delete": "bg-red-100 text-red-800",
  "draft.unreject": "bg-orange-100 text-orange-800",
  "draft.auto_approve": "bg-emerald-100 text-emerald-800",
  "draft.send_success": "bg-blue-100 text-blue-800",
  "draft.send_failure": "bg-red-100 text-red-800",
  "trigger.create": "bg-indigo-100 text-indigo-800",
  "trigger.update": "bg-indigo-100 text-indigo-800",
  "trigger.delete": "bg-red-100 text-red-800",
  "settings.update": "bg-gray-100 text-gray-800",
  "auth.login": "bg-green-100 text-green-800",
  "auth.login_denied": "bg-red-100 text-red-800",
};

const TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "trigger", label: "Triggers" },
  { key: "settings", label: "Settings" },
  { key: "auth", label: "Auth" },
];

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

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; page?: string }>;
}) {
  const { category, page: pageParam } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam ?? "1", 10));
  const pageSize = 50;

  const supabase = createServiceClient();

  const { data: settings } = await supabase
    .from("settings")
    .select("ceo_timezone")
    .eq("id", 1)
    .maybeSingle();

  const tz = settings?.ceo_timezone ?? "America/Los_Angeles";

  let query = supabase
    .from("audit_events")
    .select("*")
    .order("created_at", { ascending: false })
    .range((currentPage - 1) * pageSize, currentPage * pageSize - 1);

  if (category && category !== "all") {
    query = query.like("action", `${category}.%`);
  }

  const { data } = await query;
  const events = (data ?? []) as AuditEvent[];

  const baseHref = (cat: string, pg?: number) => {
    const params = new URLSearchParams();
    if (cat !== "all") params.set("category", cat);
    if (pg && pg > 1) params.set("page", String(pg));
    const qs = params.toString();
    return `/admin/activity${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Activity Log</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((tab) => (
          <a
            key={tab.key}
            href={baseHref(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              (category ?? "all") === tab.key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {/* Events Table */}
      {events.length === 0 ? (
        <p className="text-muted-foreground">No events recorded yet.</p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">Actor</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Entity</th>
                <th className="text-left px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {events.map((event) => (
                <tr key={event.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap" title={formatDate(event.created_at, tz)}>
                    {timeAgo(event.created_at)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {event.actor_email === "system" ? (
                      <span className="text-muted-foreground italic">system</span>
                    ) : (
                      <span>{event.actor_email.split("@")[0]}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={ACTION_COLORS[event.action] ?? "bg-gray-100 text-gray-800"}>
                      {ACTION_LABELS[event.action] ?? event.action}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {event.entity_type === "draft" && event.entity_id ? (
                      <Link
                        href={`/dashboard/${event.entity_id}`}
                        className="text-blue-600 hover:underline font-mono text-xs"
                      >
                        {event.entity_id.slice(0, 8)}...
                      </Link>
                    ) : event.entity_type === "trigger" && event.entity_id ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {(event.metadata.name as string) ?? event.entity_id.slice(0, 8)}
                      </span>
                    ) : event.entity_type ? (
                      <span className="text-muted-foreground text-xs">{event.entity_type}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {renderMetadata(event)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center gap-2 justify-end">
        {currentPage > 1 && (
          <a
            href={baseHref(category ?? "all", currentPage - 1)}
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted/50"
          >
            Previous
          </a>
        )}
        <span className="text-sm text-muted-foreground">Page {currentPage}</span>
        {events.length === pageSize && (
          <a
            href={baseHref(category ?? "all", currentPage + 1)}
            className="px-3 py-1.5 text-sm border rounded-md hover:bg-muted/50"
          >
            Next
          </a>
        )}
      </div>
    </div>
  );
}

function renderMetadata(event: AuditEvent): string {
  const m = event.metadata;
  if (!m || Object.keys(m).length === 0) return "";

  switch (event.action) {
    case "draft.approve":
      return m.edited ? "with edits" : "";
    case "draft.send_now":
      return m.success ? "" : `failed: ${m.error}`;
    case "draft.send_failure":
      return `attempt ${m.attempt}: ${m.error}`;
    case "draft.auto_approve":
      return `confidence ${m.confidence}% (threshold ${m.threshold}%)`;
    case "trigger.create":
    case "trigger.update":
      return (m.name as string) ?? "";
    default:
      return "";
  }
}
