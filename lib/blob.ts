import { del, head, list, put } from "@vercel/blob";

const COMMON_PUT_OPTIONS = {
  access: "public" as const,
  addRandomSuffix: false as const,
  allowOverwrite: true as const,
};

export type StoredFile = {
  pathname: string;
  url: string;
  size: number;
};

export async function putBlob(
  pathname: string,
  body: Buffer | string | ReadableStream,
  contentType?: string,
): Promise<StoredFile> {
  const result = await put(pathname, body, {
    ...COMMON_PUT_OPTIONS,
    contentType,
  });
  const bodySize =
    typeof body === "string"
      ? Buffer.byteLength(body, "utf-8")
      : Buffer.isBuffer(body)
        ? body.length
        : 0;
  return { pathname: result.pathname, url: result.url, size: bodySize };
}

export async function fetchBlobContent(pathname: string): Promise<{
  body: ArrayBuffer;
  contentType: string;
} | null> {
  const info = await safeHead(pathname);
  if (!info) return null;
  const res = await fetch(info.url);
  if (!res.ok) return null;
  return {
    body: await res.arrayBuffer(),
    contentType:
      res.headers.get("content-type") ?? info.contentType ?? "application/octet-stream",
  };
}

export async function safeHead(pathname: string) {
  try {
    return await head(pathname);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function deletePrefix(prefix: string): Promise<number> {
  let cursor: string | undefined;
  let count = 0;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    if (page.blobs.length === 0) break;
    await del(page.blobs.map((b) => b.url));
    count += page.blobs.length;
    cursor = page.cursor;
  } while (cursor);
  return count;
}

export async function copyPrefix(from: string, to: string): Promise<number> {
  if (!from.endsWith("/")) from += "/";
  if (!to.endsWith("/")) to += "/";

  let cursor: string | undefined;
  let count = 0;
  do {
    const page = await list({ prefix: from, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      const suffix = blob.pathname.slice(from.length);
      const target = `${to}${suffix}`;
      const res = await fetch(blob.url);
      if (!res.ok) continue;
      const body = Buffer.from(await res.arrayBuffer());
      await put(target, body, {
        ...COMMON_PUT_OPTIONS,
        contentType: res.headers.get("content-type") ?? undefined,
      });
      count++;
    }
    cursor = page.cursor;
  } while (cursor);
  return count;
}

export async function listPrefix(prefix: string): Promise<{ pathname: string; url: string; size: number }[]> {
  const out: { pathname: string; url: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    for (const b of page.blobs) {
      out.push({ pathname: b.pathname, url: b.url, size: b.size });
    }
    cursor = page.cursor;
  } while (cursor);
  return out;
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const msg = (err as { message?: string }).message ?? "";
  return /not.?found|404/i.test(msg);
}
