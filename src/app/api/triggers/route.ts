import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

const TriggerSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  email_type: z.enum(["congratulatory", "promotional", "welcome"]),
  reply_in_thread: z.boolean().default(false),
  match_mode: z.enum(["llm", "gmail_filter"]).default("llm"),
  gmail_filter_query: z.string().max(500).nullable().default(null),
  reply_window_min_hours: z.number().positive().default(4),
  reply_window_max_hours: z.number().positive().default(6),
  enabled: z.boolean().default(true),
  sort_order: z.number().int().min(0).default(0),
}).refine(
  (data) => data.match_mode !== "gmail_filter" || (data.gmail_filter_query && data.gmail_filter_query.length > 0),
  { message: "Gmail filter query is required for gmail_filter mode", path: ["gmail_filter_query"] },
);

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
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = TriggerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("triggers")
    .insert({
      ...parsed.data,
      created_by_email: session.user.email,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}
