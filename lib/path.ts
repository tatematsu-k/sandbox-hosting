import { BadRequest } from "./errors";

const PATH_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{0,38}$/;

export function normalizeUsername(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 39);
  return cleaned || "anon";
}

export function validateUsername(username: string): string {
  const normalized = normalizeUsername(username);
  if (!USERNAME_RE.test(normalized)) {
    throw new BadRequest(`invalid username after normalization: ${normalized}`);
  }
  return normalized;
}

export function validateCustomPath(path: string): string {
  if (!PATH_RE.test(path)) {
    throw new BadRequest(
      "custom path must be 2-64 chars of [a-z0-9_-], starting with [a-z0-9]",
    );
  }
  return path;
}

export function buildAutoPath(username: string, now: Date = new Date()): string {
  const normalized = validateUsername(username);
  const ts = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${ts}_${normalized}`;
}
