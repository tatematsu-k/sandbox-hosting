import { verifyBearer } from "@/lib/auth";
import { BadRequest, Forbidden, toJsonError } from "@/lib/errors";
import { readMeta } from "@/lib/meta";
import { activate, buildPublicUrl } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const identity = verifyBearer(req);
    const { path } = (await req.json()) as { path?: string };
    if (!path) throw new BadRequest("missing `path`");

    const meta = await readMeta(path);
    if (!meta) throw new BadRequest(`unknown path: ${path}`);
    if (meta.owner !== identity.username) {
      throw new Forbidden("not the owner");
    }

    const updated = await activate(path);
    return Response.json({
      path: updated.path,
      status: updated.status,
      ttlExpiresAt: updated.ttlExpiresAt,
      url: buildPublicUrl(updated.path),
    });
  } catch (err) {
    return toJsonError(err);
  }
}
