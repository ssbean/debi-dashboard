import { createServiceClient } from "@/lib/supabase/server";
import { TriggersManager } from "./triggers-manager";
import type { Trigger } from "@/lib/types";

export default async function TriggersPage() {
  const supabase = createServiceClient();

  const [{ data }, { data: settings }] = await Promise.all([
    supabase.from("triggers").select("*").is("deleted_at", null).order("sort_order"),
    supabase.from("settings").select("ceo_timezone").eq("id", 1).maybeSingle(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Triggers</h1>
      <TriggersManager initialTriggers={(data ?? []) as Trigger[]} timezone={settings?.ceo_timezone ?? "America/Los_Angeles"} />
    </div>
  );
}
