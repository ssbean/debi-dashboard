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
    .select("id, gmail_message_id, trigger_email_from, trigger_email_subject, trigger_email_body_snippet, trigger_email_to, trigger_email_cc")
    .is("trigger_email_summary", null)
    .limit(50);

  if (!drafts?.length) {
    return NextResponse.json({ message: "No drafts need summaries", updated: 0 });
  }

  let updated = 0;
  const errors: string[] = [];

  for (const draft of drafts) {
    try {
      // Fetch full email from Gmail for body and CC context
      let fullBody = draft.trigger_email_body_snippet ?? "";
      let to = draft.trigger_email_to ?? "";
      let cc = draft.trigger_email_cc ?? "";

      if (draft.gmail_message_id) {
        const email = await fetchEmailById(draft.gmail_message_id);
        if (email) {
          if (email.body) fullBody = email.body;
          if (email.to) to = email.to;
          if (email.cc) cc = email.cc;
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
        to || undefined,
        cc || undefined,
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
