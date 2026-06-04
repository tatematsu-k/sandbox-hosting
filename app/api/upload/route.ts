import { verifyBearer } from "@/lib/auth";
import { BadRequest, toJsonError } from "@/lib/errors";
import { performUpload } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const identity = verifyBearer(req);
    const contentType = req.headers.get("content-type") ?? "";
    const customPath =
      req.headers.get("x-sandbox-path") ?? undefined;

    let kind: "html" | "zip";
    let body: Buffer;

    if (contentType.includes("application/zip")) {
      kind = "zip";
      body = Buffer.from(await req.arrayBuffer());
    } else if (contentType.includes("text/html") || contentType.includes("application/octet-stream") || contentType.startsWith("text/")) {
      kind = "html";
      body = Buffer.from(await req.arrayBuffer());
    } else if (contentType.includes("application/json")) {
      const json = (await req.json()) as { html?: string; zipBase64?: string; path?: string };
      if (json.html) {
        kind = "html";
        body = Buffer.from(json.html, "utf-8");
      } else if (json.zipBase64) {
        kind = "zip";
        body = Buffer.from(json.zipBase64, "base64");
      } else {
        throw new BadRequest("json body must contain `html` or `zipBase64`");
      }
      if (json.path) {
        return Response.json(
          await performUpload({ identity, customPath: json.path, content: { kind, body } }),
        );
      }
    } else {
      throw new BadRequest(`unsupported content-type: ${contentType}`);
    }

    if (body.length === 0) throw new BadRequest("empty body");
    if (body.length > 10 * 1024 * 1024) throw new BadRequest("body exceeds 10MB");

    const result = await performUpload({ identity, customPath, content: { kind, body } });
    return Response.json(result);
  } catch (err) {
    return toJsonError(err);
  }
}
