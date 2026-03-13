import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { summarizeEmail } from "@/lib/claude";
import { fetchEmailById } from "@/lib/gmail";

export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email || !isAdmin(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: drafts } = await supabase
    .from("drafts")
    .select("id, gmail_message_id, trigger_email_from, trigger_email_subject, trigger_email_body_snippet")
    .is("trigger_email_summary", null)
    .limit(50);

  if (!drafts?.length) {
    return NextResponse.json({ message: "No drafts need summaries", updated: 0 });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const draft of drafts) {
    try {
      // Fetch full email body from Gmail
      let fullBody = draft.trigger_email_body_snippet ?? "";
      if (draft.gmail_message_id) {
        const email = await fetchEmailById(draft.gmail_message_id);
        if (email?.body) {
          fullBody = email.body;
        }
      }

      if (!fullBody) {
        errors.push(`${draft.id}: no email body available`);
        continue;
      }

      const summary = await summarizeEmail(
        draft.trigger_email_from,
        draft.trigger_email_subject,
        fullBody,
      );
      if (summary) {
        await supabase
          .from("drafts")
          .update({ trigger_email_summary: summary })
          .eq("id", draft.id);
        updated++;
      }
    } catch (error) {
      errors.push(`${draft.id}: ${String(error)}`);
    }
  }

  return NextResponse.json({ updated, total: drafts.length, errors });
}
