import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, isAllowed, parseAllowList } from "@/src/lib/ip";

describe("parseAllowList", () => {
  it("parses empty input", () => {
    expect(parseAllowList(undefined)).toEqual([]);
    expect(parseAllowList("")).toEqual([]);
  });

  it("parses single ip and cidr", () => {
    const rules = parseAllowList("203.0.113.5, 198.51.100.0/24");
    expect(rules).toHaveLength(2);
    expect(rules[0].kind).toBe("single");
    expect(rules[1].kind).toBe("cidr");
  });

  it("skips malformed entries instead of throwing", () => {
    const rules = parseAllowList("203.0.113.5, not-an-ip, 198.51.100.0/24, 1.2.3.4/64");
    expect(rules).toHaveLength(2);
    expect(rules.map((r) => r.kind)).toEqual(["single", "cidr"]);
  });
});

describe("isAllowed", () => {
  const rules = parseAllowList("203.0.113.5, 198.51.100.0/24, 2001:db8::/32");

  it("matches exact IPv4", () => {
    expect(isAllowed("203.0.113.5", rules)).toBe(true);
  });

  it("matches CIDR IPv4", () => {
    expect(isAllowed("198.51.100.42", rules)).toBe(true);
  });

  it("rejects out-of-range", () => {
    expect(isAllowed("198.51.101.1", rules)).toBe(false);
  });

  it("matches IPv6 CIDR", () => {
    expect(isAllowed("2001:db8:0:1::1", rules)).toBe(true);
  });

  it("rejects null", () => {
    expect(isAllowed(null, rules)).toBe(false);
  });

  it("rejects when no rules", () => {
    expect(isAllowed("203.0.113.5", [])).toBe(false);
  });

  it("rejects malformed ip", () => {
    expect(isAllowed("not-an-ip", rules)).toBe(false);
  });
});

describe("clientIpFromHeaders", () => {
  it("returns first IP from x-forwarded-for", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(clientIpFromHeaders(h)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    const h = new Headers({ "x-real-ip": "203.0.113.5" });
    expect(clientIpFromHeaders(h)).toBe("203.0.113.5");
  });

  it("returns null when absent", () => {
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});
