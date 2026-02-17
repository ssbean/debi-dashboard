import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();

  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("settings")
    .update({
      confidence_threshold: body.confidence_threshold,
      ceo_email: body.ceo_email,
      ceo_timezone: body.ceo_timezone,
      company_domains: body.company_domains,
      business_hours_start: body.business_hours_start,
      business_hours_end: body.business_hours_end,
      holidays: body.holidays,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
