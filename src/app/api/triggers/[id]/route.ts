import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

const TriggerUpdateSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  email_type: z.enum(["congratulatory", "promotional", "welcome"]),
  reply_in_thread: z.boolean(),
  match_mode: z.enum(["llm", "gmail_filter"]).default("llm"),
  gmail_filter_query: z.string().max(500).nullable().default(null),
  system_prompt: z.string().max(5000).optional(),
  reply_window_min_hours: z.number().positive().optional(),
  reply_window_max_hours: z.number().positive().optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
}).strip().refine(
  (data) => data.match_mode !== "gmail_filter" || (data.gmail_filter_query && data.gmail_filter_query.length > 0),
  { message: "Gmail filter query is required for gmail_filter mode", path: ["gmail_filter_query"] },
);

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = TriggerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("triggers")
    .update({
      ...parsed.data,
      updated_by_email: session.user.email,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServiceClient();

  // Soft delete
  const { error } = await supabase
    .from("triggers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
