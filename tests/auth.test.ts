import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { verifyBearer, verifySlack } from "@/lib/auth";
import { Unauthorized } from "@/lib/errors";

const ORIGINAL = { ...process.env };

describe("verifyBearer", () => {
  beforeEach(() => {
    process.env.UPLOAD_TOKEN = "secret-token";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("accepts a valid token", () => {
    const req = new Request("https://example.com/api/upload", {
      method: "POST",
      headers: {
        authorization: "Bearer secret-token",
        "x-sandbox-user": "Tatematsu",
      },
    });
    expect(verifyBearer(req).username).toBe("tatematsu");
  });

  it("rejects missing header", () => {
    const req = new Request("https://example.com/api/upload", { method: "POST" });
    expect(() => verifyBearer(req)).toThrow(Unauthorized);
  });

  it("rejects wrong token", () => {
    const req = new Request("https://example.com/api/upload", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    expect(() => verifyBearer(req)).toThrow(Unauthorized);
  });
});

describe("verifySlack", () => {
  beforeEach(() => {
    process.env.SLACK_SIGNING_SECRET = "slack-secret";
  });
  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it("accepts a valid HMAC signature", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "command=%2Fsandbox&text=hello&user_name=tatematsu";
    const base = `v0:${ts}:${body}`;
    const sig = `v0=${createHmac("sha256", "slack-secret").update(base).digest("hex")}`;
    const req = new Request("https://example.com/api/slack/upload", {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": ts,
        "x-slack-signature": sig,
      },
    });
    const id = await verifySlack(req, body);
    expect(id.username).toBe("tatematsu");
    expect(id.source).toBe("slack");
  });

  it("rejects expired timestamps", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 60 * 10);
    const body = "user_name=tatematsu";
    const base = `v0:${ts}:${body}`;
    const sig = `v0=${createHmac("sha256", "slack-secret").update(base).digest("hex")}`;
    const req = new Request("https://example.com/api/slack/upload", {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": ts,
        "x-slack-signature": sig,
      },
    });
    await expect(verifySlack(req, body)).rejects.toThrow(Unauthorized);
  });

  it("rejects when required headers are missing", async () => {
    const req = new Request("https://example.com/api/slack/upload", {
      method: "POST",
    });
    await expect(verifySlack(req, "user_name=x")).rejects.toThrow(Unauthorized);
  });

  it("rejects tampered body", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "user_name=tatematsu";
    const base = `v0:${ts}:${body}`;
    const sig = `v0=${createHmac("sha256", "slack-secret").update(base).digest("hex")}`;
    const req = new Request("https://example.com/api/slack/upload", {
      method: "POST",
      headers: {
        "x-slack-request-timestamp": ts,
        "x-slack-signature": sig,
      },
    });
    await expect(verifySlack(req, "user_name=evil")).rejects.toThrow(Unauthorized);
  });
});
