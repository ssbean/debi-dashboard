import { createServiceClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { formatDateShort } from "@/lib/format-date";
import type { Draft } from "@/lib/types";

const statusLabel: Record<string, string> = {
  needs_drafting: "Processing…",
  pending_review: "Needs Review",
  approved: "Approved",
  auto_approved: "Approved",
  sent: "Sent",
  failed: "Failed",
  rejected: "Rejected",
};

const statusColors: Record<string, string> = {
  needs_drafting: "bg-yellow-100 text-yellow-800",
  pending_review: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  auto_approved: "bg-emerald-100 text-emerald-800",
  sent: "bg-gray-100 text-gray-800",
  failed: "bg-red-100 text-red-800",
  rejected: "bg-red-100 text-red-800",
};

export default async function DashboardPage() {
  const supabase = createServiceClient();

  const { data: drafts } = await supabase
    .from("drafts")
    .select("*, trigger:triggers(name, email_type)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: settings } = await supabase
    .from("settings")
    .select("ceo_timezone, dev_redirect_emails")
    .eq("id", 1)
    .maybeSingle();

  const tz = settings?.ceo_timezone ?? "America/Los_Angeles";
  const hasRedirect = process.env.DEV_MODE === "true" && !!settings?.dev_redirect_emails?.trim();

  const typedDrafts = (drafts ?? []) as Draft[];
  const pending = typedDrafts.filter((d) => d.status === "pending_review").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {pending > 0 ? `${pending} Draft${pending === 1 ? "" : "s"} Awaiting Review` : "All Caught Up"}
        </h1>
      </div>

      <div className="space-y-3">
        {typedDrafts.length === 0 ? (
          <p className="text-muted-foreground">
            No drafts yet. The system will create drafts as trigger emails arrive.
          </p>
        ) : (
          typedDrafts.map((draft) => (
            <Link key={draft.id} href={`/dashboard/${draft.id}`}>
              <Card className="cursor-pointer hover:bg-muted/50 transition-colors">
                <CardContent className="flex items-center justify-between py-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {draft.subject ?? draft.trigger_email_subject}
                      </span>
                      {draft.trigger && (
                        <Badge variant="outline">{draft.trigger.name}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      To: {draft.recipient_email ?? draft.trigger_email_from}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={statusColors[draft.status] ?? ""}>
                      {statusLabel[draft.status] ?? draft.status}
                      {process.env.DEV_MODE === "true" &&
                        ["approved", "auto_approved"].includes(draft.status) &&
                        (hasRedirect ? " (redirected)" : " (paused)")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDateShort(draft.created_at, tz)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
