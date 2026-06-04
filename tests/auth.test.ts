import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("@/src/lib/secrets", () => ({
  getSecret: vi.fn(),
}));

vi.mock("@/src/lib/config", () => ({
  config: {
    bucket: () => "bucket",
    table: () => "table",
    publicBaseUrl: () => "https://example.com",
    uploadTokenParam: () => "/sandbox-hosting/UPLOAD_TOKEN",
    slackSigningSecretParam: () => "/sandbox-hosting/SLACK_SIGNING_SECRET",
    slackBotTokenParam: () => undefined,
    region: () => "ap-northeast-1",
  },
}));

const { verifyBearer, verifySlack } = await import("@/src/lib/auth");
const { Unauthorized } = await import("@/src/lib/errors");
const { getSecret } = await import("@/src/lib/secrets");
const getSecretMock = vi.mocked(getSecret);

describe("verifyBearer", () => {
  beforeEach(() => {
    getSecretMock.mockResolvedValue("secret-token");
  });

  it("accepts a valid token", async () => {
    const id = await verifyBearer("Bearer secret-token", "Tatematsu.K");
    expect(id.username).toBe("tatematsu-k");
    expect(id.source).toBe("claude-code");
  });

  it("rejects missing header", async () => {
    await expect(verifyBearer(undefined, "x")).rejects.toThrow(Unauthorized);
  });

  it("rejects wrong token", async () => {
    await expect(verifyBearer("Bearer wrong", "x")).rejects.toThrow(Unauthorized);
  });
});

describe("verifySlack", () => {
  beforeEach(() => {
    getSecretMock.mockResolvedValue("slack-secret");
  });

  function sign(body: string, ts: string): string {
    return `v0=${createHmac("sha256", "slack-secret").update(`v0:${ts}:${body}`).digest("hex")}`;
  }

  it("accepts a valid HMAC signature", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "command=%2Fsandbox&text=hello&user_name=tatematsu";
    const id = await verifySlack(
      { "x-slack-request-timestamp": ts, "x-slack-signature": sign(body, ts) },
      body,
    );
    expect(id.username).toBe("tatematsu");
    expect(id.source).toBe("slack");
  });

  it("rejects expired timestamps", async () => {
    const ts = String(Math.floor(Date.now() / 1000) - 60 * 10);
    const body = "user_name=tatematsu";
    await expect(
      verifySlack(
        { "x-slack-request-timestamp": ts, "x-slack-signature": sign(body, ts) },
        body,
      ),
    ).rejects.toThrow(Unauthorized);
  });

  it("rejects when required headers are missing", async () => {
    await expect(verifySlack({}, "user_name=x")).rejects.toThrow(Unauthorized);
  });

  it("rejects tampered body", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const body = "user_name=tatematsu";
    await expect(
      verifySlack(
        { "x-slack-request-timestamp": ts, "x-slack-signature": sign(body, ts) },
        "user_name=evil",
      ),
    ).rejects.toThrow(Unauthorized);
  });
});
