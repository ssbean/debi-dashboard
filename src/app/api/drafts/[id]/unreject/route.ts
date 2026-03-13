import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { calculateSendTimeAfterApproval } from "@/lib/scheduler";
import { logAuditEvent } from "@/lib/audit-logger";
import type { Settings } from "@/lib/types";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.status !== "rejected") {
    return NextResponse.json({ error: "Only rejected drafts can be un-rejected" }, { status: 400 });
  }

  // Recalculate send time since reject cleared it
  const { data: settings } = await supabase
    .from("settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  let scheduledSendAt: string | null = null;
  if (settings) {
    const { data: scheduledDrafts } = await supabase
      .from("drafts")
      .select("scheduled_send_at")
      .in("status", ["approved", "auto_approved", "pending_review"])
      .not("scheduled_send_at", "is", null);

    const existingTimes = (scheduledDrafts ?? [])
      .map((d: { scheduled_send_at: string | null }) => d.scheduled_send_at)
      .filter((t): t is string => t !== null)
      .map((t) => new Date(t));

    scheduledSendAt = calculateSendTimeAfterApproval(
      settings as Settings,
      existingTimes,
    ).toISOString();
  }

  await supabase
    .from("drafts")
    .update({
      status: "pending_review",
      scheduled_send_at: scheduledSendAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  await logAuditEvent(supabase, {
    action: "draft.unreject",
    actorEmail: session.user.email,
    entityType: "draft",
    entityId: id,
  });

  return NextResponse.json({ success: true });
}
