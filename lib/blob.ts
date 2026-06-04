import { BlobNotFoundError, del, head, list, put } from "@vercel/blob";

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
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

export async function deleteOne(pathname: string): Promise<boolean> {
  const info = await safeHead(pathname);
  if (!info) return false;
  await del(info.url);
  return true;
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
