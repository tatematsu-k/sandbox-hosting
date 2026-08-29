import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { Buffer } from "node:buffer";
import { verifyBearer, verifySlack } from "@/src/lib/auth";
import { BadRequest, HttpError, Unauthorized } from "@/src/lib/errors";
import {
  buildPublicUrl,
  activate,
  deletePath,
  performUpload,
} from "@/src/lib/upload";
import { listAll, listByOwner, readMeta } from "@/src/lib/meta";
import { parseSlackText } from "@/src/lib/slack-text";

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_BYTES = 10 * 1024 * 1024;

export const handler = async (
  event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyStructuredResultV2> => {
  const method = event.requestContext.http.method.toUpperCase();
  const path = event.rawPath.replace(/\/+$/, "") || "/";

  try {
    if (method === "POST" && path === "/upload") return await handleUpload(event);
    if (method === "POST" && path === "/list") return await handleList(event);
    if (method === "POST" && path === "/activate") return await handleActivate(event);
    if (method === "POST" && path === "/delete") return await handleDelete(event);
    if (method === "POST" && path === "/slack/upload") return await handleSlack(event);
    if (method === "GET" && path === "/healthz") return json(200, { ok: true });
    return json(404, { error: "route not found" });
  } catch (err) {
    return errorResponse(err);
  }
};

async function handleUpload(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const headers = normalizeHeaders(event.headers);
  const identity = await verifyBearer(headers["authorization"]);
  const customPath = headers["x-sandbox-path"];
  const contentType = (headers["content-type"] ?? "").toLowerCase();
  const body = readBody(event);

  let kind: "html" | "zip";
  let payload: Buffer;
  let pathFromJson: string | undefined;

  if (contentType.includes("application/zip")) {
    kind = "zip";
    payload = body;
  } else if (contentType.includes("application/json")) {
    let parsed: { html?: unknown; zipBase64?: unknown; path?: unknown };
    try {
      parsed = JSON.parse(body.toString("utf-8")) as typeof parsed;
    } catch {
      throw new BadRequest("invalid JSON body");
    }
    if (typeof parsed.path === "string") pathFromJson = parsed.path;
    if (typeof parsed.html === "string") {
      kind = "html";
      payload = Buffer.from(parsed.html, "utf-8");
    } else if (typeof parsed.zipBase64 === "string") {
      kind = "zip";
      payload = Buffer.from(parsed.zipBase64, "base64");
    } else {
      throw new BadRequest("json body must contain `html` or `zipBase64`");
    }
  } else if (contentType.startsWith("text/") || contentType === "") {
    kind = "html";
    payload = body;
  } else {
    throw new BadRequest(`unsupported content-type: ${contentType || "<empty>"}`);
  }

  if (payload.length === 0) throw new BadRequest("empty body");
  const limit = kind === "zip" ? MAX_ZIP_BYTES : MAX_HTML_BYTES;
  if (payload.length > limit) {
    throw new BadRequest(`body exceeds limit: ${payload.length} > ${limit}`);
  }

  const result = await performUpload({
    identity,
    customPath: pathFromJson ?? customPath ?? undefined,
    content: { kind, body: payload },
  });
  return json(200, result);
}

async function handleList(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const headers = normalizeHeaders(event.headers);
  const identity = await verifyBearer(headers["authorization"]);
  const body = safeJsonBody<{ scope?: "mine" | "all" }>(event);
  const scope =
    body.scope ?? headers["x-sandbox-scope"] ?? "mine";

  const items =
    scope === "all" ? await listAll() : await listByOwner(identity.username);

  return json(200, {
    scope,
    count: items.length,
    items: items
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((m) => ({
        path: m.path,
        owner: m.owner,
        type: m.type,
        status: m.status,
        url: m.status === "published" ? buildPublicUrl(m.path) : null,
        ttlExpiresAt: m.ttlExpiresAt,
        updatedAt: m.updatedAt,
        source: m.source,
      })),
  });
}

async function handleActivate(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const headers = normalizeHeaders(event.headers);
  const identity = await verifyBearer(headers["authorization"]);
  const { path } = safeJsonBody<{ path?: string }>(event);
  if (!path) throw new BadRequest("missing `path`");

  const meta = await readMeta(path);
  if (!meta) throw new BadRequest(`unknown path: ${path}`);
  if (meta.owner !== identity.username) throw new Unauthorized("not the owner");

  const updated = await activate(path);
  return json(200, {
    path: updated.path,
    status: updated.status,
    ttlExpiresAt: updated.ttlExpiresAt,
    url: buildPublicUrl(updated.path),
  });
}

async function handleDelete(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const headers = normalizeHeaders(event.headers);
  const identity = await verifyBearer(headers["authorization"]);
  const { path } = safeJsonBody<{ path?: string }>(event);
  if (!path) throw new BadRequest("missing `path`");

  const meta = await readMeta(path);
  if (!meta) throw new BadRequest(`unknown path: ${path}`);
  if (meta.owner !== identity.username) throw new Unauthorized("not the owner");

  await deletePath(path);
  return json(200, { path, deleted: true });
}

async function handleSlack(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const headers = normalizeHeaders(event.headers);
  const rawBody = readBody(event).toString("utf-8");
  const identity = await verifySlack(headers, rawBody);
  const params = new URLSearchParams(rawBody);
  const text = params.get("text") ?? "";
  const explicitFileUrl = params.get("file_url")?.trim();
  const parsed = parseSlackText(text);
  const fileUrl = explicitFileUrl || parsed.asFileUrl;

  let kind: "html" | "zip";
  let body: Buffer;

  if (fileUrl) {
    const fetched = await fetchSlackFile(fileUrl);
    kind = fetched.kind;
    body = fetched.body;
  } else if (parsed.payload.length > 0) {
    kind = "html";
    body = Buffer.from(parsed.payload, "utf-8");
  } else {
    throw new BadRequest("no html / file");
  }

  const result = await performUpload({
    identity,
    customPath: parsed.customPath,
    content: { kind, body },
  });

  return {
    statusCode: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      response_type: "ephemeral",
      text: `:white_check_mark: published <${result.url}|${result.path}>`,
    }),
  };
}

async function fetchSlackFile(url: string): Promise<{ kind: "html" | "zip"; body: Buffer }> {
  const headers: Record<string, string> = {};
  const slackTokenParam = process.env.SLACK_BOT_TOKEN_PARAM;
  if (slackTokenParam && url.startsWith("https://files.slack.com")) {
    const { getSecret } = await import("@/src/lib/secrets");
    const token = await getSecret(slackTokenParam);
    if (token && token !== "REPLACE_ME") {
      headers.authorization = `Bearer ${token}`;
    }
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new BadRequest(`failed to fetch file: ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  const body = Buffer.from(await res.arrayBuffer());
  if (ct.includes("application/zip") || url.toLowerCase().endsWith(".zip")) {
    return { kind: "zip", body };
  }
  return { kind: "html", body };
}

function normalizeHeaders(
  headers: APIGatewayProxyEventV2["headers"],
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k.toLowerCase()] = v ?? undefined;
  }
  return out;
}

function readBody(event: APIGatewayProxyEventV2): Buffer {
  if (!event.body) return Buffer.alloc(0);
  if (event.isBase64Encoded) return Buffer.from(event.body, "base64");
  return Buffer.from(event.body, "utf-8");
}

function safeJsonBody<T>(event: APIGatewayProxyEventV2): T {
  if (!event.body) return {} as T;
  try {
    return JSON.parse(readBody(event).toString("utf-8")) as T;
  } catch {
    return {} as T;
  }
}

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

function errorResponse(err: unknown): APIGatewayProxyStructuredResultV2 {
  if (err instanceof HttpError) {
    return json(err.status, { error: err.message });
  }
  console.error("[sandbox/api] unhandled", err);
  return json(500, { error: "internal error" });
}
