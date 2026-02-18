import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail, getLatestThreadMessageId } from "@/lib/gmail";
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

  if (!draft.recipient_email || !draft.subject || !draft.body) {
    return NextResponse.json({ error: "Draft missing required fields (recipient, subject, body)" }, { status: 400 });
  }

  const { data: settings } = await serviceClient
    .from("settings")
    .select("ceo_email, dev_redirect_emails")
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
    const threadId = draft.trigger?.reply_in_thread ? draft.gmail_thread_id : null;

    let inReplyTo: string | null = null;
    if (threadId) {
      inReplyTo = await getLatestThreadMessageId(settings.ceo_email, threadId);
    }

    await sendEmail(
      settings.ceo_email,
      draft.recipient_email,
      draft.subject,
      draft.body,
      threadId,
      inReplyTo,
      draft.trigger_email_cc,
      redirectTo,
    );

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
