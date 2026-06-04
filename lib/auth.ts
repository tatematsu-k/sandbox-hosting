import { createHmac, timingSafeEqual } from "node:crypto";
import { Unauthorized } from "./errors";
import { normalizeUsername } from "./path";

const SLACK_TIMESTAMP_WINDOW_S = 60 * 5;

export type Identity = {
  username: string;
  source: "slack" | "claude-code";
};

export function verifyBearer(req: Request): Identity {
  const expected = process.env.UPLOAD_TOKEN;
  if (!expected) throw new Unauthorized("UPLOAD_TOKEN not configured");

  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) throw new Unauthorized("missing bearer token");

  const provided = match[1].trim();
  if (!safeEqual(provided, expected)) {
    throw new Unauthorized("invalid token");
  }

  const rawUser =
    req.headers.get("x-sandbox-user") ?? req.headers.get("x-user") ?? "anon";
  return { username: normalizeUsername(rawUser), source: "claude-code" };
}

export async function verifySlack(
  req: Request,
  rawBody: string,
): Promise<Identity> {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) throw new Unauthorized("SLACK_SIGNING_SECRET not configured");

  const ts = req.headers.get("x-slack-request-timestamp");
  const sig = req.headers.get("x-slack-signature");
  if (!ts || !sig) throw new Unauthorized("missing Slack signature headers");

  const tsNum = Number.parseInt(ts, 10);
  if (Number.isNaN(tsNum)) throw new Unauthorized("invalid Slack timestamp");

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > SLACK_TIMESTAMP_WINDOW_S) {
    throw new Unauthorized("Slack signature expired");
  }

  const base = `v0:${ts}:${rawBody}`;
  const computed = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
  if (!safeEqual(computed, sig)) {
    throw new Unauthorized("invalid Slack signature");
  }

  const params = new URLSearchParams(rawBody);
  const rawUser = params.get("user_name") ?? params.get("user_id") ?? "anon";
  return { username: normalizeUsername(rawUser), source: "slack" };
}

export function verifyCron(req: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Unauthorized("CRON_SECRET not configured");

  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (match && safeEqual(match[1].trim(), secret)) return;

  const cronHeader = req.headers.get("x-vercel-cron");
  if (cronHeader && cronHeader.length > 0) return;

  throw new Unauthorized("cron auth failed");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
