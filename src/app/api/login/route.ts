import { NextResponse } from "next/server";
import { COOKIE_NAME, makeSessionCookieValue } from "@/lib/auth";

export async function POST(req: Request) {
  const { password } = await req.json();
  const expected = process.env.APP_PASSWORD;

  if (!expected) {
    return NextResponse.json({ error: "APP_PASSWORD not set" }, { status: 500 });
  }
  if (password !== expected) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, makeSessionCookieValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
