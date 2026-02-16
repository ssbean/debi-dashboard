import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { recipient_email, subject, body } = await req.json();

  if (!recipient_email || !subject || !body) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Fetch current draft
  const { data: draft } = await supabase
    .from("drafts")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (!["pending_review", "needs_drafting"].includes(draft.status)) {
    return NextResponse.json({ error: "Draft cannot be approved in current state" }, { status: 400 });
  }

  // Check if body was edited — save as style example
  const wasEdited = draft.body && body !== draft.body;

  // Update draft
  await supabase
    .from("drafts")
    .update({
      recipient_email,
      subject,
      body,
      original_body: wasEdited ? draft.body : draft.original_body,
      status: "approved",
      approved_by_email: session.user.email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  // If edited, save as style example
  if (wasEdited) {
    await supabase.from("style_examples").insert({
      trigger_id: draft.trigger_id,
      subject,
      body,
      source: "edited",
    });
  }

  return NextResponse.json({ success: true });
}
