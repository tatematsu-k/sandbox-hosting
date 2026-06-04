import { verifyCron } from "@/lib/auth";
import { toJsonError } from "@/lib/errors";
import { listAllMeta } from "@/lib/meta";
import { deactivate } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request): Promise<Response> {
  try {
    verifyCron(req);
    const now = new Date();
    const all = await listAllMeta();
    const expired = all.filter(
      (m) =>
        m.type === "auto" &&
        m.status === "published" &&
        m.ttlExpiresAt &&
        new Date(m.ttlExpiresAt) <= now,
    );

    const results: { path: string; status: string }[] = [];
    for (const m of expired) {
      const updated = await deactivate(m.path);
      results.push({ path: updated.path, status: updated.status });
    }

    return Response.json({
      checkedAt: now.toISOString(),
      total: all.length,
      expired: results.length,
      sites: results,
    });
  } catch (err) {
    return toJsonError(err);
  }
}
