import { describe, expect, it } from "vitest";
import {
  buildAutoPath,
  normalizeUsername,
  validateCustomPath,
  validateUsername,
} from "@/lib/path";
import { BadRequest } from "@/lib/errors";

describe("normalizeUsername", () => {
  it("lowercases and replaces unsafe chars", () => {
    expect(normalizeUsername("Tatematsu.K")).toBe("tatematsu-k");
  });

  it("falls back to anon for empty input", () => {
    expect(normalizeUsername("")).toBe("anon");
  });

  it("truncates long usernames", () => {
    const long = "a".repeat(80);
    expect(normalizeUsername(long).length).toBe(39);
  });
});

describe("validateUsername", () => {
  it("accepts normalized values", () => {
    expect(validateUsername("tatematsu")).toBe("tatematsu");
  });
});

describe("validateCustomPath", () => {
  it("accepts valid slugs", () => {
    expect(validateCustomPath("demo-foo")).toBe("demo-foo");
    expect(validateCustomPath("a1")).toBe("a1");
  });

  it("rejects uppercase", () => {
    expect(() => validateCustomPath("Demo")).toThrow(BadRequest);
  });

  it("rejects too short", () => {
    expect(() => validateCustomPath("a")).toThrow(BadRequest);
  });

  it("rejects leading dash", () => {
    expect(() => validateCustomPath("-demo")).toThrow(BadRequest);
  });

  it("rejects slashes", () => {
    expect(() => validateCustomPath("foo/bar")).toThrow(BadRequest);
  });
});

describe("buildAutoPath", () => {
  it("produces timestamp_username", () => {
    const fixed = new Date("2026-06-04T12:00:00.000Z");
    expect(buildAutoPath("tatematsu", fixed)).toBe("20260604T120000Z_tatematsu");
  });
});
