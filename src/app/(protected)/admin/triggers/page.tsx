import { createClient } from "@/lib/supabase/server";
import { TriggersManager } from "./triggers-manager";
import type { Trigger } from "@/lib/types";

export default async function TriggersPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from("triggers")
    .select("*")
    .is("deleted_at", null)
    .order("sort_order");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Triggers</h1>
      <TriggersManager initialTriggers={(data ?? []) as Trigger[]} />
    </div>
  );
}
