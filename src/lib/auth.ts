import { createHmac, timingSafeEqual } from "node:crypto";
import { Unauthorized } from "./errors";
import { normalizeUsername } from "./path";
import { config } from "./config";
import { getSecret } from "./secrets";
import { hashToken, lookupOwner } from "./tokens";

const SLACK_TIMESTAMP_WINDOW_S = 60 * 5;

export type Identity = {
  username: string;
  source: "slack" | "claude-code";
};

export async function verifyBearer(
  authorization: string | undefined,
): Promise<Identity> {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!match) throw new Unauthorized("missing bearer token");
  const owner = await lookupOwner(hashToken(match[1].trim()));
  if (!owner) throw new Unauthorized("invalid token");
  return { username: owner, source: "claude-code" };
}

export async function verifySlack(
  headers: Record<string, string | undefined>,
  rawBody: string,
): Promise<Identity> {
  const secret = await getSecret(config.slackSigningSecretParam());
  const ts = headers["x-slack-request-timestamp"];
  const sig = headers["x-slack-signature"];
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

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
