import { createServiceClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format-date";
import type { Draft } from "@/lib/types";

export default async function HistoryPage() {
  const supabase = createServiceClient();

  const { data: settings } = await supabase
    .from("settings")
    .select("ceo_timezone")
    .eq("id", 1)
    .maybeSingle();

  const tz = settings?.ceo_timezone ?? "America/Los_Angeles";

  const { data } = await supabase
    .from("drafts")
    .select("*, trigger:triggers(name, email_type)")
    .in("status", ["sent", "failed", "rejected"])
    .order("updated_at", { ascending: false })
    .limit(100);

  const drafts = (data ?? []) as Draft[];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Sent History</h1>
      <div className="space-y-3">
        {drafts.length === 0 ? (
          <p className="text-muted-foreground">No sent emails yet.</p>
        ) : (
          drafts.map((draft) => (
            <Card key={draft.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="space-y-1">
                  <span className="font-medium">{draft.subject}</span>
                  <p className="text-sm text-muted-foreground">
                    To: {draft.recipient_email} | {draft.trigger?.name}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={draft.status === "sent" ? "default" : "destructive"}
                  >
                    {draft.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {draft.sent_at
                      ? formatDate(draft.sent_at, tz)
                      : draft.updated_at
                        ? formatDate(draft.updated_at, tz)
                        : ""}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
