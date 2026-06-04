import unzipper from "unzipper";
import { BadRequest } from "./errors";

export type ExtractedFile = {
  relativePath: string;
  buffer: Buffer;
  contentType: string;
};

const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_PATH_LEN = 256;

const SAFE_PATH_RE = /^[A-Za-z0-9_.\-\/]+$/;

export function sanitizeZipPath(rawPath: string): string {
  const relative = rawPath.replace(/^\.\//, "").replace(/^\//, "");
  if (relative.length === 0) throw new BadRequest("empty zip path");
  if (relative.length > MAX_PATH_LEN) throw new BadRequest("zip path too long");
  if (relative.includes("\0")) throw new BadRequest("zip path contains null byte");
  if (relative.includes("..")) throw new BadRequest(`zip path traversal: ${relative}`);
  if (relative.split("/").some((seg) => seg === "" || seg === ".")) {
    throw new BadRequest(`zip path contains empty or self segment: ${relative}`);
  }
  if (!SAFE_PATH_RE.test(relative)) {
    throw new BadRequest(`zip path contains unsafe characters: ${relative}`);
  }
  return relative;
}

export async function extractZip(buffer: Buffer): Promise<ExtractedFile[]> {
  const dir = await unzipper.Open.buffer(buffer);
  const out: ExtractedFile[] = [];
  let total = 0;
  let hasIndex = false;

  for (const entry of dir.files) {
    if (entry.type !== "File") continue;
    if (out.length >= MAX_FILES) throw new BadRequest("zip contains too many files");

    const relative = sanitizeZipPath(entry.path);
    const data = await entry.buffer();
    total += data.length;
    if (total > MAX_TOTAL_BYTES) throw new BadRequest("zip extracted size too large");

    if (relative === "index.html") hasIndex = true;
    out.push({
      relativePath: relative,
      buffer: data,
      contentType: detectContentType(relative),
    });
  }

  if (!hasIndex) throw new BadRequest("zip must contain index.html at root");
  return out;
}

function detectContentType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".woff")) return "font/woff";
  return "application/octet-stream";
}
