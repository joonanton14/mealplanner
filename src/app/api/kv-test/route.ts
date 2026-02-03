import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export async function GET() {
  await kv.set("test:key", "hello");
  const value = await kv.get("test:key");
  return NextResponse.json({ ok: true, value });
}
