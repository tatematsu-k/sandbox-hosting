import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

const { hashToken } = await import("@/src/lib/tokens");

describe("hashToken", () => {
  it("returns the sha256 hex digest of the input", () => {
    const expected = createHash("sha256").update("my-token").digest("hex");
    expect(hashToken("my-token")).toBe(expected);
  });

  it("is deterministic", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("differs for different inputs", () => {
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});
