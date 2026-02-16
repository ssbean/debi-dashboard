import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();

  const { data: draft } = await supabase
    .from("drafts")
    .select("status")
    .eq("id", id)
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (!["pending_review", "needs_drafting"].includes(draft.status)) {
    return NextResponse.json({ error: "Draft cannot be rejected in current state" }, { status: 400 });
  }

  await supabase
    .from("drafts")
    .update({
      status: "rejected",
      scheduled_send_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ success: true });
}
