import { describe, expect, it } from "vitest";
import { isAllowedEdge, parseIp, type EdgeRule } from "@/src/lib/edge-ip";

describe("parseIp", () => {
  it("parses IPv4", () => {
    expect(parseIp("203.0.113.5")).toEqual({
      kind: "v4",
      bytes: [203, 0, 113, 5],
    });
  });

  it("rejects malformed IPv4", () => {
    expect(parseIp("999.0.0.1")).toBeNull();
    expect(parseIp("203.0.113")).toBeNull();
    expect(parseIp("203.0.113.5.6")).toBeNull();
    expect(parseIp("01.2.3.4")).toBeNull();
  });

  it("parses IPv6 compressed form", () => {
    const parsed = parseIp("2001:db8::1");
    expect(parsed?.kind).toBe("v6");
    expect(parsed?.bytes.length).toBe(16);
    expect(parsed?.bytes[0]).toBe(0x20);
    expect(parsed?.bytes[1]).toBe(0x01);
    expect(parsed?.bytes[15]).toBe(0x01);
  });

  it("parses IPv6 full form", () => {
    const parsed = parseIp("2001:0db8:0000:0000:0000:0000:0000:0001");
    expect(parsed?.bytes[0]).toBe(0x20);
    expect(parsed?.bytes[15]).toBe(0x01);
  });

  it("parses :: shorthand for any-address", () => {
    const parsed = parseIp("::");
    expect(parsed?.bytes.every((b) => b === 0)).toBe(true);
  });

  it("rejects invalid IPv6", () => {
    expect(parseIp("not:an:ip")).toBeNull();
    expect(parseIp("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIp("1:::")).toBeNull();
  });
});

describe("isAllowedEdge", () => {
  const rules: EdgeRule[] = [
    { addr: "203.0.113.5", prefix: null },
    { addr: "198.51.100.0", prefix: 24 },
    { addr: "2001:db8::", prefix: 32 },
  ];

  it("matches exact IPv4", () => {
    expect(isAllowedEdge("203.0.113.5", rules)).toBe(true);
  });

  it("matches IPv4 CIDR range", () => {
    expect(isAllowedEdge("198.51.100.42", rules)).toBe(true);
    expect(isAllowedEdge("198.51.100.255", rules)).toBe(true);
  });

  it("rejects IPv4 outside CIDR", () => {
    expect(isAllowedEdge("198.51.101.1", rules)).toBe(false);
    expect(isAllowedEdge("203.0.113.6", rules)).toBe(false);
  });

  it("matches IPv6 CIDR", () => {
    expect(isAllowedEdge("2001:db8:0:1::1", rules)).toBe(true);
    expect(isAllowedEdge("2001:db9::1", rules)).toBe(false);
  });

  it("does not cross IPv4/IPv6 boundaries", () => {
    expect(isAllowedEdge("198.51.100.0", [{ addr: "::ffff:198.51.100.0", prefix: null }])).toBe(false);
  });

  it("rejects empty / unparsable IPs", () => {
    expect(isAllowedEdge(null, rules)).toBe(false);
    expect(isAllowedEdge("", rules)).toBe(false);
    expect(isAllowedEdge("not-an-ip", rules)).toBe(false);
  });

  it("handles /0 CIDR as match-all", () => {
    expect(isAllowedEdge("8.8.8.8", [{ addr: "0.0.0.0", prefix: 0 }])).toBe(true);
  });

  it("handles /32 CIDR as exact match", () => {
    expect(isAllowedEdge("1.2.3.4", [{ addr: "1.2.3.4", prefix: 32 }])).toBe(true);
    expect(isAllowedEdge("1.2.3.5", [{ addr: "1.2.3.4", prefix: 32 }])).toBe(false);
  });
});
