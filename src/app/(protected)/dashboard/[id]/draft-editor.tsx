"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDate } from "@/lib/format-date";
import type { Draft } from "@/lib/types";

export function DraftEditor({ draft, timezone, isAdmin = false }: { draft: Draft; timezone: string; isAdmin?: boolean }) {
  const router = useRouter();
  const recipientEmail = draft.recipient_email ?? "";
  const subject = draft.subject ?? "";
  const [body, setBody] = useState(draft.body ?? "");
  const [loading, setLoading] = useState(false);
  const [showRecipients, setShowRecipients] = useState(false);
  const isReplyAll = !!(draft.trigger?.reply_in_thread && draft.gmail_thread_id);

  const canEdit = ["pending_review", "needs_drafting"].includes(draft.status);
  const canAdminEdit = isAdmin && draft.status !== "sent";
  const canSendNow = ["approved", "auto_approved"].includes(draft.status);

  async function handleSendNow() {
    setLoading(true);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/send-now`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to send");
      }
      toast.success("Email sent successfully");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleUnreject() {
    setLoading(true);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/unreject`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed");
      }
      toast.success("Draft moved back to pending review");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this draft?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/delete`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed");
      }
      toast.success("Draft deleted");
      router.push("/dashboard");
      router.refresh();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  }

  async function handleAdminSave() {
    setLoading(true);
    try {
      const res = await fetch(`/api/drafts/${draft.id}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed");
      }
      toast.success("Draft saved");
      router.refresh();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  }

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
          {draft.trigger_email_to && (
            <p><strong>To:</strong> {draft.trigger_email_to}</p>
          )}
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
          {draft.sent_to ? (
            <div className="space-y-2">
              <Label>Sent To</Label>
              <Input value={draft.sent_to} disabled className="bg-muted" />
              {draft.sent_cc && (
                <>
                  <Label>Sent CC</Label>
                  <Input value={draft.sent_cc} disabled className="bg-muted" />
                </>
              )}
            </div>
          ) : isReplyAll ? (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowRecipients(!showRecipients)}
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                Reply-all to everyone on this thread
                {showRecipients ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showRecipients && (
                <div className="space-y-1 text-sm text-muted-foreground pl-1">
                  {draft.trigger_email_to && <p><strong>To:</strong> {draft.trigger_email_to}</p>}
                  {draft.trigger_email_cc && <p><strong>CC:</strong> {draft.trigger_email_cc}</p>}
                  <p className="text-xs italic pt-1">Final recipients resolved from the latest thread message at send time</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="recipient">Recipient</Label>
              <Input
                id="recipient"
                value={recipientEmail}
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
              disabled={!(canEdit || canAdminEdit)}
              rows={12}
            />
          </div>
          {draft.scheduled_send_at && (
            <p className="text-sm text-muted-foreground">
              Scheduled: {formatDate(draft.scheduled_send_at, timezone)}
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

      {canSendNow && (
        <div className="flex gap-3">
          <Button onClick={handleSendNow} disabled={loading}>
            Send Now
          </Button>
          <Button variant="outline" onClick={() => router.back()} disabled={loading}>
            Back
          </Button>
        </div>
      )}

      {isAdmin && (
        <div className="border-t pt-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Admin Actions</p>
          <div className="flex gap-3">
            {canAdminEdit && body !== (draft.body ?? "") && (
              <Button variant="secondary" onClick={handleAdminSave} disabled={loading}>
                Save Edit
              </Button>
            )}
            {draft.status === "rejected" && (
              <Button variant="secondary" onClick={handleUnreject} disabled={loading}>
                Un-reject
              </Button>
            )}
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              Delete Draft
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
