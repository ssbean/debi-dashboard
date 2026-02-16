import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("triggers")
    .select("*")
    .is("deleted_at", null)
    .order("sort_order");

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("triggers")
    .insert({
      name: body.name,
      description: body.description,
      email_type: body.email_type,
      reply_in_thread: body.reply_in_thread ?? false,
      enabled: body.enabled ?? true,
      sort_order: body.sort_order ?? 0,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}
