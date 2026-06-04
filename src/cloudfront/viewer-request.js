// CloudFront Function — viewer-request
// IP allowlist + directory index resolution + origin path mapping.
//
// Constraints:
// - cloudfront-js-2.0 runtime: ES2015 + a subset of 2016+. No Node APIs.
// - Single-file, < 10KB compiled, must run in < 1ms.
// - The ALLOWED_RULES array is templated by Terraform at deploy time.
//
// IMPORTANT: this matching logic is duplicated in `src/lib/edge-ip.ts`
// where it is unit-tested (`tests/edge-ip.test.ts`). When you change
// the matching algorithm here, change it there too and re-run vitest.

/* TERRAFORM_INJECT_RULES */
var ALLOWED_RULES = __ALLOWED_RULES__;

function handler(event) {
  var request = event.request;
  var ip = event.viewer.ip;

  if (!isAllowed(ip, ALLOWED_RULES)) {
    return {
      statusCode: 403,
      statusDescription: "Forbidden",
      headers: { "content-type": { value: "text/plain; charset=utf-8" } },
      body: "Forbidden",
    };
  }

  if (request.uri === "/" || request.uri === "") {
    return request;
  }

  if (endsWith(request.uri, "/")) {
    request.uri = request.uri + "index.html";
  } else if (!hasExtension(request.uri)) {
    request.uri = request.uri + "/index.html";
  }

  request.uri = "/published" + request.uri;
  return request;
}

function endsWith(s, suffix) {
  if (s.length < suffix.length) return false;
  return s.substring(s.length - suffix.length) === suffix;
}

function hasExtension(uri) {
  var last = uri.lastIndexOf("/");
  var dot = uri.lastIndexOf(".");
  return dot > last && dot < uri.length - 1;
}

function isAllowed(ip, rules) {
  if (!ip) return false;
  var parsed = parseIp(ip);
  if (!parsed) return false;
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    var ruleAddr = parseIp(rule.addr);
    if (!ruleAddr) continue;
    if (ruleAddr.kind !== parsed.kind) continue;
    if (rule.prefix === null) {
      if (sameBytes(ruleAddr.bytes, parsed.bytes)) return true;
    } else {
      if (cidrMatch(parsed.bytes, ruleAddr.bytes, rule.prefix)) return true;
    }
  }
  return false;
}

function parseIp(input) {
  if (input.indexOf(":") >= 0) {
    return parseIpv6(input);
  }
  return parseIpv4(input);
}

function parseIpv4(input) {
  var parts = input.split(".");
  if (parts.length !== 4) return null;
  var bytes = [];
  for (var i = 0; i < 4; i++) {
    var n = parseInt(parts[i], 10);
    if (isNaN(n) || n < 0 || n > 255 || String(n) !== parts[i]) return null;
    bytes.push(n);
  }
  return { kind: "v4", bytes: bytes };
}

function parseIpv6(input) {
  var parts = input.split("::");
  if (parts.length > 2) return null;
  var head = parts[0].length > 0 ? parts[0].split(":") : [];
  var tail = parts.length === 2 && parts[1].length > 0 ? parts[1].split(":") : [];
  var totalGroups = head.length + tail.length;
  if (totalGroups > 8) return null;
  if (parts.length === 1 && totalGroups !== 8) return null;
  var missing = 8 - totalGroups;
  var groups = head;
  for (var i = 0; i < missing; i++) groups.push("0");
  for (var j = 0; j < tail.length; j++) groups.push(tail[j]);

  var bytes = [];
  for (var k = 0; k < 8; k++) {
    var n = parseInt(groups[k], 16);
    if (isNaN(n) || n < 0 || n > 0xffff) return null;
    bytes.push((n >> 8) & 0xff);
    bytes.push(n & 0xff);
  }
  return { kind: "v6", bytes: bytes };
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function cidrMatch(addr, network, prefix) {
  var fullBytes = Math.floor(prefix / 8);
  var remainBits = prefix % 8;
  for (var i = 0; i < fullBytes; i++) {
    if (addr[i] !== network[i]) return false;
  }
  if (remainBits === 0) return true;
  var mask = (0xff << (8 - remainBits)) & 0xff;
  return (addr[fullBytes] & mask) === (network[fullBytes] & mask);
}
