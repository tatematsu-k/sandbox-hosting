import { verifyBearer } from "@/lib/auth";
import { toJsonError } from "@/lib/errors";
import { listAllMeta } from "@/lib/meta";
import { buildPublicUrl } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const identity = verifyBearer(req);
    const scope =
      req.headers.get("x-sandbox-scope") ??
      (await safeJson(req)).scope ??
      "mine";

    const all = await listAllMeta();
    const filtered =
      scope === "all" ? all : all.filter((m) => m.owner === identity.username);

    return Response.json({
      scope,
      count: filtered.length,
      items: filtered
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
  } catch (err) {
    return toJsonError(err);
  }
}

async function safeJson(req: Request): Promise<{ scope?: string }> {
  try {
    return (await req.clone().json()) as { scope?: string };
  } catch {
    return {};
  }
}
