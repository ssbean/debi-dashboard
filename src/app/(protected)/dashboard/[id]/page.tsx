import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { DraftEditor } from "./draft-editor";
import { isAdmin as checkAdmin } from "@/lib/admin";
import type { Draft } from "@/lib/types";

export default async function DraftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [session, supabase] = [await auth(), createServiceClient()];

  const [{ data: draft }, { data: settings }] = await Promise.all([
    supabase
      .from("drafts")
      .select("*, trigger:triggers(name, email_type, description, reply_in_thread)")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("settings").select("ceo_timezone").eq("id", 1).maybeSingle(),
  ]);

  if (!draft) notFound();

  const isAdmin = checkAdmin(session?.user?.email);

  return <DraftEditor draft={draft as Draft} timezone={settings?.ceo_timezone ?? "America/Los_Angeles"} isAdmin={isAdmin} />;
}
