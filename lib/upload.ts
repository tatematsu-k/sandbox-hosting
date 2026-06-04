import type { Identity } from "./auth";
import { putBlob, deletePrefix, listPrefix } from "./blob";
import { BadRequest } from "./errors";
import {
  buildAutoPath,
  validateCustomPath,
} from "./path";
import {
  computeTtl,
  metaKey,
  nowIso,
  publishedKey,
  readMeta,
  type SiteMeta,
  type SiteType,
  writeMeta,
} from "./meta";
import { extractZip, type ExtractedFile } from "./zip";

export type UploadInput = {
  identity: Identity;
  customPath?: string | null;
  content: { kind: "html"; body: Buffer } | { kind: "zip"; body: Buffer };
};

export type UploadResult = {
  path: string;
  type: SiteType;
  url: string;
  status: "published";
  files: string[];
};

export async function performUpload(input: UploadInput): Promise<UploadResult> {
  const { identity, customPath } = input;

  let path: string;
  let type: SiteType;
  if (customPath && customPath.length > 0) {
    path = validateCustomPath(customPath);
    type = "custom";
  } else {
    path = buildAutoPath(identity.username);
    type = "auto";
  }

  const existing = await readMeta(path);
  if (existing && type === "custom") {
    await deletePrefix(`published/${path}/`);
    await deletePrefix(`unpublished/${path}/`);
  } else if (existing && type === "auto") {
    throw new BadRequest(`auto path collision: ${path}`);
  }

  const files: ExtractedFile[] =
    input.content.kind === "zip"
      ? await extractZip(input.content.body)
      : [
          {
            relativePath: "index.html",
            buffer: input.content.body,
            contentType: "text/html; charset=utf-8",
          },
        ];

  for (const f of files) {
    await putBlob(publishedKey(path, f.relativePath), f.buffer, f.contentType);
  }

  const meta: SiteMeta = {
    path,
    owner: identity.username,
    type,
    status: "published",
    createdAt: existing?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    ttlExpiresAt: computeTtl(type),
    files: files.map((f) => f.relativePath),
    source: identity.source,
  };
  await writeMeta(meta);

  return {
    path,
    type,
    url: buildPublicUrl(path),
    status: "published",
    files: meta.files,
  };
}

export function buildPublicUrl(path: string): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
  return `${base}/${path}/`;
}

export async function activate(path: string): Promise<SiteMeta> {
  const meta = await readMeta(path);
  if (!meta) throw new BadRequest(`unknown path: ${path}`);

  if (meta.status === "published") {
    const refreshed: SiteMeta = {
      ...meta,
      ttlExpiresAt: computeTtl(meta.type),
      updatedAt: nowIso(),
    };
    await writeMeta(refreshed);
    return refreshed;
  }

  await movePrefix(`unpublished/${path}/`, `published/${path}/`);

  const refreshed: SiteMeta = {
    ...meta,
    status: "published",
    ttlExpiresAt: computeTtl(meta.type),
    updatedAt: nowIso(),
  };
  await writeMeta(refreshed);
  return refreshed;
}

export async function deactivate(path: string): Promise<SiteMeta> {
  const meta = await readMeta(path);
  if (!meta) throw new BadRequest(`unknown path: ${path}`);
  if (meta.status === "published") {
    await movePrefix(`published/${path}/`, `unpublished/${path}/`);
  }
  const refreshed: SiteMeta = {
    ...meta,
    status: "unpublished",
    updatedAt: nowIso(),
  };
  await writeMeta(refreshed);
  return refreshed;
}

export async function deletePath(path: string): Promise<void> {
  const meta = await readMeta(path);
  if (!meta) throw new BadRequest(`unknown path: ${path}`);
  await deletePrefix(`published/${path}/`);
  await deletePrefix(`unpublished/${path}/`);
  await deletePrefix(`${metaKey(path)}`);
}

async function movePrefix(from: string, to: string): Promise<void> {
  const blobs = await listPrefix(from);
  for (const b of blobs) {
    const suffix = b.pathname.slice(from.length);
    const res = await fetch(b.url);
    if (!res.ok) continue;
    const body = Buffer.from(await res.arrayBuffer());
    await putBlob(
      `${to}${suffix}`,
      body,
      res.headers.get("content-type") ?? undefined,
    );
  }
  await deletePrefix(from);
}
