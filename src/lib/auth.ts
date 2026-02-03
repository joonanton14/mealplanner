import crypto from "crypto";

export const COOKIE_NAME = "mp_session";

function sign(value: string) {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) throw new Error("COOKIE_SECRET not set");
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export function makeSessionCookieValue() {
  const value = "ok";
  return `${value}.${sign(value)}`;
}

export function verifySessionCookie(raw?: string) {
  if (!raw) return false;
  const [value, sig] = raw.split(".");
  if (!value || !sig) return false;
  return value === "ok" && sign(value) === sig;
}
