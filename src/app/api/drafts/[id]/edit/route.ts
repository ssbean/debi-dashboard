import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { logAuditEvent } from "@/lib/audit-logger";
import { z } from "zod";

const EditSchema = z.object({
  body: z.string().min(1, "Body is required"),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const parsed = EditSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

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

  if (draft.status === "sent") {
    return NextResponse.json({ error: "Cannot edit a sent draft" }, { status: 400 });
  }

  await supabase
    .from("drafts")
    .update({
      body: parsed.data.body,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  await logAuditEvent(supabase, {
    action: "draft.edit",
    actorEmail: session.user.email,
    entityType: "draft",
    entityId: id,
  });

  return NextResponse.json({ success: true });
}
