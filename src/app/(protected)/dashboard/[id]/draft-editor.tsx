"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import type { Draft } from "@/lib/types";

export function DraftEditor({ draft }: { draft: Draft }) {
  const router = useRouter();
  const recipientEmail = draft.recipient_email ?? "";
  const subject = draft.subject ?? "";
  const [body, setBody] = useState(draft.body ?? "");
  const [loading, setLoading] = useState(false);

  const canEdit = ["pending_review", "needs_drafting"].includes(draft.status);

  async function handleRegenerate() {
    setLoading(true);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/regenerate`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed");
      }
      toast.success("Draft queued for regeneration");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleAction(action: "approve" | "reject") {
    setLoading(true);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed");
      }
      toast.success(action === "approve" ? "Draft approved" : "Draft rejected");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Draft Detail</h1>
        <Badge>{draft.status.replace("_", " ")}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Trigger Email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><strong>From:</strong> {draft.trigger_email_from}</p>
          {draft.trigger_email_cc && (
            <p><strong>CC:</strong> {draft.trigger_email_cc}</p>
          )}
          <p><strong>Subject:</strong> {draft.trigger_email_subject}</p>
          {draft.trigger_email_body_snippet && (
            <p className="text-muted-foreground whitespace-pre-wrap">{draft.trigger_email_body_snippet}</p>
          )}
          {draft.trigger && (
            <div className="flex gap-2 pt-2">
              <Badge variant="outline">{draft.trigger.name}</Badge>
              <span className="text-muted-foreground">Confidence: {draft.confidence_score}%</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Draft Response</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recipient">Recipient Email</Label>
            <Input
              id="recipient"
              value={recipientEmail}
              disabled
              className="bg-muted"
            />
          </div>
          {draft.trigger_email_cc && (
            <div className="space-y-2">
              <Label htmlFor="cc">CC</Label>
              <Input
                id="cc"
                value={draft.trigger_email_cc}
                disabled
                className="bg-muted"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input
              id="subject"
              value={subject}
              disabled
              className="bg-muted"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="body">Body</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={!canEdit}
              rows={12}
            />
          </div>
          {draft.scheduled_send_at && (
            <p className="text-sm text-muted-foreground">
              Scheduled: {new Date(draft.scheduled_send_at).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <div className="flex gap-3">
          <Button onClick={() => handleAction("approve")} disabled={loading}>
            Approve & Schedule
          </Button>
          <Button variant="destructive" onClick={() => handleAction("reject")} disabled={loading}>
            Reject
          </Button>
          <Button variant="secondary" onClick={handleRegenerate} disabled={loading}>
            Regenerate
          </Button>
          <Button variant="outline" onClick={() => router.back()} disabled={loading}>
            Back
          </Button>
        </div>
      )}
    </div>
  );
}
