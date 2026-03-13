"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  Mail,
  MailCheck,
  RefreshCw,
  Send,
  Shield,
  Sparkles,
  Trash2,
  Undo2,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { formatDate } from "@/lib/format-date";
import type { Draft } from "@/lib/types";

/** Extract display name from "Name <email>" format */
function parseSenderName(from: string): { name: string; email: string } {
  const match = from.match(/^(.+?)\s*<(.+?)>$/);
  if (match) return { name: match[1].replace(/^["']|["']$/g, "").trim(), email: match[2] };
  return { name: from, email: from };
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  needs_drafting: {
    label: "Processing",
    color: "bg-amber-50 text-amber-700 border-amber-200",
    icon: <RefreshCw className="h-3 w-3 animate-spin" />,
  },
  pending_review: {
    label: "Needs Review",
    color: "bg-blue-50 text-blue-700 border-blue-200",
    icon: <Mail className="h-3 w-3" />,
  },
  approved: {
    label: "Approved",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: <Clock className="h-3 w-3" />,
  },
  auto_approved: {
    label: "Auto-approved",
    color: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: <Sparkles className="h-3 w-3" />,
  },
  sent: {
    label: "Sent",
    color: "bg-gray-50 text-gray-600 border-gray-200",
    icon: <MailCheck className="h-3 w-3" />,
  },
  failed: {
    label: "Failed",
    color: "bg-red-50 text-red-700 border-red-200",
    icon: <Mail className="h-3 w-3" />,
  },
  rejected: {
    label: "Rejected",
    color: "bg-red-50 text-red-600 border-red-200",
    icon: <Mail className="h-3 w-3" />,
  },
};

export function DraftEditor({ draft, timezone, isAdmin = false }: { draft: Draft; timezone: string; isAdmin?: boolean }) {
  const router = useRouter();
  const recipientEmail = draft.recipient_email ?? "";
  const subject = draft.subject ?? "";
  const [body, setBody] = useState(draft.body ?? "");
  const [loading, setLoading] = useState(false);
  const [showRecipients, setShowRecipients] = useState(false);
  const [showOriginalEmail, setShowOriginalEmail] = useState(false);
  const isReplyAll = !!(draft.trigger?.reply_in_thread && draft.gmail_thread_id);

  const canEdit = ["pending_review", "needs_drafting"].includes(draft.status);
  const canAdminEdit = isAdmin && draft.status !== "sent";
  const canSendNow = ["approved", "auto_approved"].includes(draft.status);
  const sender = parseSenderName(draft.trigger_email_from);
  const status = statusConfig[draft.status] ?? { label: draft.status, color: "bg-gray-100 text-gray-700 border-gray-200", icon: null };

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
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
          className="shrink-0 -ml-2"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            {draft.trigger && (
              <span className="text-lg font-semibold">{draft.trigger.name}</span>
            )}
            <Badge variant="outline" className={`${status.color} border gap-1 shrink-0`}>
              {status.icon}
              {status.label}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 truncate">
            {draft.trigger_email_subject}
            <span className="mx-1.5 opacity-40">from</span>
            {sender.name}
          </p>
        </div>
      </div>

      {/* AI Summary — the hero section, falls back to body snippet */}
      {(draft.trigger_email_summary || draft.trigger_email_body_snippet) && (
        <Card className="border-l-4 border-l-blue-400 bg-blue-50/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-sm leading-relaxed">
                {draft.trigger_email_summary ?? draft.trigger_email_body_snippet}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trigger & context details — collapsible */}
      <div>
        <button
          type="button"
          onClick={() => setShowOriginalEmail(!showOriginalEmail)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showOriginalEmail ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Original email details
        </button>
        {showOriginalEmail && (
          <Card className="mt-2">
            <CardContent className="py-4 space-y-2 text-sm">
              {draft.trigger_email_to && (
                <p><span className="text-muted-foreground">To:</span> {draft.trigger_email_to}</p>
              )}
              {draft.trigger_email_cc && (
                <p><span className="text-muted-foreground">CC:</span> {draft.trigger_email_cc}</p>
              )}
              {draft.trigger_email_body_snippet && (
                <div className="mt-3 p-3 rounded-md bg-muted/50 text-muted-foreground whitespace-pre-wrap text-xs font-mono leading-relaxed">
                  {draft.trigger_email_body_snippet}
                </div>
              )}
              {draft.trigger && (
                <div className="flex items-center gap-2 pt-1">
                  <Badge variant="outline" className="text-xs">{draft.trigger.name}</Badge>
                  <span className="text-xs text-muted-foreground">{draft.confidence_score}% confidence</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Separator />

      {/* Draft Response */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          Draft Reply
        </h2>

        {/* Recipients */}
        {draft.sent_bcc ? (
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">BCC:</span> {draft.sent_bcc}</p>
          </div>
        ) : draft.sent_to ? (
          <div className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Sent to:</span> {draft.sent_to}</p>
            {draft.sent_cc && (
              <p><span className="text-muted-foreground">CC:</span> {draft.sent_cc}</p>
            )}
          </div>
        ) : isReplyAll ? (
          <div>
            <button
              type="button"
              onClick={() => setShowRecipients(!showRecipients)}
              className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              BCC to thread recipients
              {showRecipients ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showRecipients && (
              <div className="mt-2 pl-1 space-y-1 text-sm text-muted-foreground">
                {draft.trigger_email_to && <p><span className="font-medium">To:</span> {draft.trigger_email_to}</p>}
                {draft.trigger_email_cc && <p><span className="font-medium">CC:</span> {draft.trigger_email_cc}</p>}
                <p className="text-xs italic pt-1">All recipients will be BCC&apos;d — they won&apos;t see other recipients</p>
              </div>
            )}
          </div>
        ) : recipientEmail ? (
          <p className="text-sm"><span className="text-muted-foreground">BCC:</span> {recipientEmail}</p>
        ) : null}

        {/* Subject */}
        <div className="space-y-1.5">
          <Label htmlFor="subject" className="text-xs text-muted-foreground">Subject</Label>
          <Input
            id="subject"
            value={subject}
            disabled
            className="bg-muted/50 border-dashed"
          />
        </div>

        {/* Body */}
        <div className="space-y-1.5">
          <Label htmlFor="body" className="text-xs text-muted-foreground">
            Body
            {(canEdit || canAdminEdit) && (
              <span className="ml-1.5 text-blue-600 font-normal">(editable)</span>
            )}
          </Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={!(canEdit || canAdminEdit)}
            rows={14}
            className="leading-relaxed"
          />
        </div>

        {draft.scheduled_send_at ? (
          new Date(draft.scheduled_send_at) > new Date() ? (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {draft.status === "sent"
                ? `Sent ${formatDate(draft.scheduled_send_at, timezone)}`
                : `Scheduled for ${formatDate(draft.scheduled_send_at, timezone)}`}
            </div>
          ) : canEdit ? (
            <div className="flex items-center gap-1.5 text-sm text-amber-600">
              <Clock className="h-3.5 w-3.5" />
              Original send time has passed — will be rescheduled on approval
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Was scheduled for {formatDate(draft.scheduled_send_at, timezone)}
            </div>
          )
        ) : canEdit ? (
          <div className="flex items-center gap-1.5 text-sm text-amber-600">
            <Clock className="h-3.5 w-3.5" />
            Send time will be scheduled on approval
          </div>
        ) : null}
      </div>

      {/* Primary Actions */}
      {canEdit && (
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={() => handleAction("approve")} disabled={loading} className="gap-1.5">
            <MailCheck className="h-4 w-4" />
            Approve & Schedule
          </Button>
          <Button variant="outline" onClick={() => handleAction("reject")} disabled={loading} className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200">
            Reject
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" onClick={handleRegenerate} disabled={loading} size="sm" className="gap-1.5 text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate
          </Button>
        </div>
      )}

      {canSendNow && (
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={handleSendNow} disabled={loading} className="gap-1.5">
            <Send className="h-4 w-4" />
            Send Now
          </Button>
        </div>
      )}

      {/* Admin Actions */}
      {isAdmin && (
        <>
          <Separator />
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Admin</span>
            </div>
            <div className="flex items-center gap-2">
              {canAdminEdit && body !== (draft.body ?? "") && (
                <Button variant="secondary" size="sm" onClick={handleAdminSave} disabled={loading} className="gap-1.5">
                  <Save className="h-3.5 w-3.5" />
                  Save Edit
                </Button>
              )}
              {draft.status === "rejected" && (
                <Button variant="secondary" size="sm" onClick={handleUnreject} disabled={loading} className="gap-1.5">
                  <Undo2 className="h-3.5 w-3.5" />
                  Un-reject
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleDelete} disabled={loading} className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
