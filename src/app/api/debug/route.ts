import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const checks: Record<string, unknown> = {};

  // Check Supabase
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("settings")
      .select("id, ceo_email, company_domains")
      .eq("id", 1)
      .maybeSingle();
    checks.supabase = error ? { error: error.message } : { ok: true, hasSettings: !!data, ceo: data?.ceo_email };
  } catch (e) {
    checks.supabase = { error: e instanceof Error ? e.message : String(e) };
  }

  // Check env vars exist (not values)
  checks.env = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    GOOGLE_KEY_LENGTH: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.length ?? 0,
    GOOGLE_KEY_START: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.slice(0, 30),
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    CRON_SECRET: !!process.env.CRON_SECRET,
  };

  // Check Gmail auth
  try {
    const { google } = await import("googleapis");
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      subject: checks.supabase && typeof checks.supabase === "object" && "ceo" in checks.supabase
        ? (checks.supabase as { ceo?: string }).ceo
        : undefined,
    });
    const token = await auth.authorize();
    checks.gmail = { ok: true, tokenType: token.token_type };
  } catch (e) {
    checks.gmail = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json(checks);
}
