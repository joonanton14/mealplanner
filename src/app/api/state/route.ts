import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionCookie } from "@/lib/auth";

const KEY = "household:main";

const DEFAULT_STATE = {
  recipes: [],
  pantryText: "salt\npepper\nolive oil",
  picked: [],
};

async function authed() {
  const c = await cookies();
  const raw = c.get(COOKIE_NAME)?.value;
  return verifySessionCookie(raw);
}

export async function GET() {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const state = (await kv.get(KEY)) ?? DEFAULT_STATE;
  return NextResponse.json(state);
}

export async function POST(req: Request) {
  if (!(await authed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const state = await req.json();
  await kv.set(KEY, state);
  return NextResponse.json({ ok: true });
}
