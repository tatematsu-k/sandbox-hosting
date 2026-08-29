import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/src/lib/secrets", () => ({
  getSecret: vi.fn(),
}));

vi.mock("@/src/lib/tokens", () => ({
  hashToken: vi.fn((raw: string) => `hash:${raw}`),
  lookupOwner: vi.fn(),
}));

vi.mock("@/src/lib/slack-users", () => ({
  lookupEmail: vi.fn(),
}));

vi.mock("@/src/lib/config", () => ({
  config: {
    bucket: () => "bucket",
    table: () => "table",
    publicBaseUrl: () => "https://example.com",
    tokensTable: () => "tokens-table",
    slackUsersTable: () => "slack-users-table",
    slackSigningSecretParam: () => "/sandbox-hosting/SLACK_SIGNING_SECRET",
    slackBotTokenParam: () => undefined,
    region: () => "ap-northeast-1",
  },
}));

const { verifyBearer, verifySlack } = await import("@/src/lib/auth");
const { Unauthorized } = await import("@/src/lib/errors");
const { getSecret } = await import("@/src/lib/secrets");
const { lookupOwner } = await import("@/src/lib/tokens");
const { lookupEmail } = await import("@/src/lib/slack-users");
const getSecretMock = vi.mocked(getSecret);
const lookupOwnerMock = vi.mocked(lookupOwner);
const lookupEmailMock = vi.mocked(lookupEmail);

describe("verifyBearer", () => {
  beforeEach(() => {
    lookupOwnerMock.mockImplementation(async (hash) =>
      hash === "hash:secret-token" ? "tatematsu-k" : null,
    );
  });

  it("accepts a valid token and returns the stored owner", async () => {
    const id = await verifyBearer("Bearer secret-token");
    expect(id.username).toBe("tatematsu-k");
    expect(id.source).toBe("claude-code");
  });

  it("rejects missing header", async () => {
    await expect(verifyBearer(undefined)).rejects.toThrow(Unauthorized);
  });

  it("rejects a token with no matching record", async () => {
    await expect(verifyBearer("Bearer wrong")).rejects.toThrow(Unauthorized);
  });
});

describe("verifySlack", () => {
  beforeEach(() => {
    getSecretMock.mockResolvedValue("slack-secret");
    lookupEmailMock.mockImplementation(async (id) =>
      id === "U123" ? "tatematsu@giftee.co" : null,
    );
  });

  function sign(body: string, ts: string): string {
    return `v0=${createHmac("sha256", "slack-secret").update(`v0:${ts}:${body}`).digest("hex")}`;
  }

  it("accepts an allowlisted user and returns their cached email", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "command=%2Fsandbox&text=hello&user_id=U123";
    const id = await verifySlack(
      { "x-slack-request-timestamp": ts, "x-slack-signature": sign(body, ts) },
      body,
    );
    expect(id.username).toBe("tatematsu@giftee.co");
    expect(id.source).toBe("slack");
  });

  it("rejects a user not on the allowlist", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "user_id=U999";
    await expect(
      verifySlack(
        { "x-slack-request-timestamp": ts, "x-slack-signature": sign(body, ts) },
        body,
      ),
    ).rejects.toThrow(Unauthorized);
  });

  it("rejects a request with no user_id", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "text=hello";
    await expect(
      verifySlack(
        { "x-slack-request-timestamp": ts, "x-slack-signature": sign(body, ts) },
        body,
      ),
    ).rejects.toThrow(Unauthorized);
  });

  it("rejects expired timestamps", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 60 * 10);
    const body = "user_id=U123";
    await expect(
      verifySlack(
        { "x-slack-request-timestamp": ts, "x-slack-signature": sign(body, ts) },
        body,
      ),
    ).rejects.toThrow(Unauthorized);
  });

  it("rejects when required headers are missing", async () => {
    await expect(verifySlack({}, "user_id=U123")).rejects.toThrow(Unauthorized);
  });

  it("rejects tampered body", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "user_id=U123";
    await expect(
      verifySlack(
        { "x-slack-request-timestamp": ts, "x-slack-signature": sign(body, ts) },
        "user_id=U999",
      ),
    ).rejects.toThrow(Unauthorized);
  });
});
