import ipaddr from "ipaddr.js";

export type IpRule =
  | { kind: "single"; addr: ipaddr.IPv4 | ipaddr.IPv6 }
  | { kind: "cidr"; addr: ipaddr.IPv4 | ipaddr.IPv6; prefix: number };

export function parseAllowList(raw: string | undefined): IpRule[] {
  if (!raw) return [];
  const rules: IpRule[] = [];
  for (const piece of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    try {
      rules.push(parseRule(piece));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[sandbox/ip] skipping invalid allowlist entry "${piece}": ${reason}`);
    }
  }
  return rules;
}

function parseRule(input: string): IpRule {
  if (input.includes("/")) {
    const [addrPart, prefixPart] = input.split("/");
    const addr = ipaddr.parse(addrPart);
    const prefix = Number.parseInt(prefixPart, 10);
    if (Number.isNaN(prefix) || prefix < 0) {
      throw new Error(`invalid CIDR prefix: ${input}`);
    }
    const maxPrefix = addr.kind() === "ipv4" ? 32 : 128;
    if (prefix > maxPrefix) {
      throw new Error(`CIDR prefix out of range: ${input}`);
    }
    return { kind: "cidr", addr, prefix };
  }
  return { kind: "single", addr: ipaddr.parse(input) };
}

export function isAllowed(clientIp: string | null, rules: IpRule[]): boolean {
  if (rules.length === 0) return false;
  if (!clientIp) return false;

  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(clientIp);
  } catch {
    return false;
  }

  for (const rule of rules) {
    if (rule.kind === "single") {
      if (sameKind(parsed, rule.addr) && parsed.toString() === rule.addr.toString()) {
        return true;
      }
    } else {
      if (sameKind(parsed, rule.addr) && parsed.match(rule.addr, rule.prefix)) {
        return true;
      }
    }
  }
  return false;
}

function sameKind(
  a: ipaddr.IPv4 | ipaddr.IPv6,
  b: ipaddr.IPv4 | ipaddr.IPv6,
): boolean {
  return a.kind() === b.kind();
}

export function clientIpFromHeaders(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip");
}
