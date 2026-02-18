import { createServiceClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { formatDateShort } from "@/lib/format-date";
import type { Draft } from "@/lib/types";

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
    .order("created_at", { ascending: false })
    .limit(50);

  // Email processing stats
  const { data: settings } = await supabase
    .from("settings")
    .select("ceo_timezone")
    .eq("id", 1)
    .maybeSingle();

  const tz = settings?.ceo_timezone ?? "America/Los_Angeles";

  const { count: totalScanned } = await supabase
    .from("processed_emails")
    .select("*", { count: "exact", head: true });

  const { count: totalMatched } = await supabase
    .from("processed_emails")
    .select("*", { count: "exact", head: true })
    .eq("matched", true);

  const typedDrafts = (drafts ?? []) as Draft[];

  const pending = typedDrafts.filter((d) => d.status === "pending_review").length;
  const autoApproved = typedDrafts.filter((d) => d.status === "auto_approved").length;
  const sent = typedDrafts.filter((d) => d.status === "sent").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Emails Scanned
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalScanned ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Matched
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalMatched ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Review
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Auto-Approved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{autoApproved}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{sent}</div>
          </CardContent>
        </Card>
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
                      To: {draft.recipient_email ?? "—"}{draft.trigger_email_cc ? ` | CC: ${draft.trigger_email_cc}` : ""} | From trigger: {draft.trigger_email_from}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {draft.confidence_score}%
                    </span>
                    <Badge className={statusColors[draft.status] ?? ""}>
                      {draft.status.replace("_", " ")}
                      {process.env.DEV_MODE === "true" &&
                        ["approved", "auto_approved"].includes(draft.status) &&
                        " (paused)"}
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
