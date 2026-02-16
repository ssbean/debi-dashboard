import { createServiceClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";
import type { Settings } from "@/lib/types";

export default async function SettingsPage() {
  const supabase = createServiceClient();

  const { data } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();

  if (!data) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Settings not initialized. Run the database migration first.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>
      <SettingsForm initialSettings={data as Settings} />
    </div>
  );
}
