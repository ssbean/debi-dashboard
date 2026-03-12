import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { sendDraft } from "@/lib/send-draft";
import { logger } from "@/lib/logger";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const serviceClient = createServiceClient();

  const { data: draft } = await serviceClient
    .from("drafts")
    .select("*, trigger:triggers(reply_in_thread)")
    .eq("id", id)
    .maybeSingle();

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (!["approved", "auto_approved"].includes(draft.status)) {
    return NextResponse.json({ error: "Draft must be approved to send" }, { status: 400 });
  }

  if (!draft.subject || !draft.body) {
    return NextResponse.json({ error: "Draft missing required fields (subject, body)" }, { status: 400 });
  }

  const { data: settings } = await serviceClient
    .from("settings")
    .select("dev_redirect_emails")
    .eq("id", 1)
    .maybeSingle();

  if (!settings) {
    return NextResponse.json({ error: "Settings not configured" }, { status: 500 });
  }

  const redirectTo = process.env.DEV_MODE === "true" ? settings.dev_redirect_emails?.trim() || null : null;
  if (process.env.DEV_MODE === "true" && !redirectTo) {
    return NextResponse.json({ error: "DEV_MODE active but no redirect emails configured" }, { status: 400 });
  }

  try {
    await sendDraft(draft, serviceClient, { redirectTo });

    await serviceClient
      .from("drafts")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    const attempts = (draft.send_attempts ?? 0) + 1;

    await serviceClient
      .from("drafts")
      .update({
        send_attempts: attempts,
        send_error: String(error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id);

    logger.error(`Failed to send draft ${draft.id}`, "send-now", {
      error: String(error),
      attempt: attempts,
    });

    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
