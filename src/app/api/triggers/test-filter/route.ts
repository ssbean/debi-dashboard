import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { testGmailFilter } from "@/lib/gmail";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { query } = await req.json();
  if (!query || typeof query !== "string" || query.length > 500) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  try {
    const results = await testGmailFilter(query);
    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json({ error: "Gmail query failed" }, { status: 500 });
  }
}
