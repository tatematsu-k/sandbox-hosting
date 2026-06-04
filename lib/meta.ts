import { fetchBlobContent, listPrefix, putBlob } from "./blob";

export type SiteType = "auto" | "custom";
export type SiteStatus = "published" | "unpublished";
export type Source = "slack" | "claude-code";

export type SiteMeta = {
  path: string;
  owner: string;
  type: SiteType;
  status: SiteStatus;
  createdAt: string;
  updatedAt: string;
  ttlExpiresAt: string | null;
  files: string[];
  source: Source;
};

const TTL_DAYS = 90;

export function metaKey(path: string): string {
  return `meta/${path}.json`;
}

export function publishedKey(path: string, file = "index.html"): string {
  return `published/${path}/${file}`;
}

export function unpublishedKey(path: string, file = "index.html"): string {
  return `unpublished/${path}/${file}`;
}

export function computeTtl(type: SiteType, now: Date = new Date()): string | null {
  if (type === "custom") return null;
  const expires = new Date(now);
  expires.setUTCDate(expires.getUTCDate() + TTL_DAYS);
  return expires.toISOString();
}

export async function readMeta(path: string): Promise<SiteMeta | null> {
  const content = await fetchBlobContent(metaKey(path));
  if (!content) return null;
  try {
    return JSON.parse(Buffer.from(content.body).toString("utf-8")) as SiteMeta;
  } catch (err) {
    console.warn("[sandbox] meta JSON parse error", path, err);
    return null;
  }
}

export async function writeMeta(meta: SiteMeta): Promise<void> {
  await putBlob(metaKey(meta.path), JSON.stringify(meta, null, 2), "application/json");
}

export async function listAllMeta(): Promise<SiteMeta[]> {
  const blobs = await listPrefix("meta/");
  const out: SiteMeta[] = [];
  for (const b of blobs) {
    const path = b.pathname.replace(/^meta\//, "").replace(/\.json$/, "");
    const meta = await readMeta(path);
    if (meta) out.push(meta);
  }
  return out;
}

export function nowIso(): string {
  return new Date().toISOString();
}
