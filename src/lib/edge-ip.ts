// Reference implementation of the IP allowlist logic embedded in
// `src/cloudfront/viewer-request.js`. Kept here so we can unit-test the
// matching behaviour outside of the CloudFront runtime. The .js file
// duplicates this logic in ES2015-only syntax — KEEP THEM IN SYNC.
// Any algorithmic change here MUST be mirrored in viewer-request.js
// (and re-deployed via `terraform apply`).

export type EdgeRule = { addr: string; prefix: number | null };
export type ParsedIp = { kind: "v4" | "v6"; bytes: number[] };

export function parseIp(input: string): ParsedIp | null {
  if (input.includes(":")) return parseIpv6(input);
  return parseIpv4(input);
}

function parseIpv4(input: string): ParsedIp | null {
  const parts = input.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (Number.isNaN(n) || n < 0 || n > 255 || String(n) !== p) return null;
    bytes.push(n);
  }
  return { kind: "v4", bytes };
}

function parseIpv6(input: string): ParsedIp | null {
  const sides = input.split("::");
  if (sides.length > 2) return null;
  const head = sides[0].length > 0 ? sides[0].split(":") : [];
  const tail = sides.length === 2 && sides[1].length > 0 ? sides[1].split(":") : [];
  const totalGroups = head.length + tail.length;
  if (totalGroups > 8) return null;
  if (sides.length === 1 && totalGroups !== 8) return null;
  const missing = 8 - totalGroups;
  const groups = head.slice();
  for (let i = 0; i < missing; i++) groups.push("0");
  for (const g of tail) groups.push(g);

  const bytes: number[] = [];
  for (const g of groups) {
    if (g.length === 0) return null;
    const n = Number.parseInt(g, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
    bytes.push((n >> 8) & 0xff);
    bytes.push(n & 0xff);
  }
  return { kind: "v6", bytes };
}

function sameBytes(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function cidrMatch(addr: number[], network: number[], prefix: number): boolean {
  const fullBytes = Math.floor(prefix / 8);
  const remainBits = prefix % 8;
  for (let i = 0; i < fullBytes; i++) if (addr[i] !== network[i]) return false;
  if (remainBits === 0) return true;
  const mask = (0xff << (8 - remainBits)) & 0xff;
  return (addr[fullBytes] & mask) === (network[fullBytes] & mask);
}

export function isAllowedEdge(ip: string | null | undefined, rules: EdgeRule[]): boolean {
  if (!ip) return false;
  const parsed = parseIp(ip);
  if (!parsed) return false;
  for (const rule of rules) {
    const ruleAddr = parseIp(rule.addr);
    if (!ruleAddr || ruleAddr.kind !== parsed.kind) continue;
    if (rule.prefix === null) {
      if (sameBytes(ruleAddr.bytes, parsed.bytes)) return true;
    } else {
      if (cidrMatch(parsed.bytes, ruleAddr.bytes, rule.prefix)) return true;
    }
  }
  return false;
}
