import { verifyBearer } from "@/lib/auth";
import { BadRequest, toJsonError } from "@/lib/errors";
import { performUpload } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_HTML_BYTES = 5 * 1024 * 1024;
const MAX_ZIP_BYTES = 10 * 1024 * 1024;

type PreparedBody = {
  kind: "html" | "zip";
  body: Buffer;
  customPath?: string;
};

export async function POST(req: Request): Promise<Response> {
  try {
    const identity = verifyBearer(req);
    const headerPath = req.headers.get("x-sandbox-path") ?? undefined;
    const prepared = await readRequestBody(req, headerPath);
    enforceSizeLimit(prepared);
    const result = await performUpload({
      identity,
      customPath: prepared.customPath,
      content: { kind: prepared.kind, body: prepared.body },
    });
    return Response.json(result);
  } catch (err) {
    return toJsonError(err);
  }
}

async function readRequestBody(
  req: Request,
  headerPath: string | undefined,
): Promise<PreparedBody> {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("application/zip")) {
    const body = Buffer.from(await req.arrayBuffer());
    return { kind: "zip", body, customPath: headerPath };
  }

  if (contentType.includes("application/json")) {
    const json = (await req.json()) as {
      html?: string;
      zipBase64?: string;
      path?: string;
    };
    const customPath = json.path ?? headerPath;
    if (json.html !== undefined) {
      return { kind: "html", body: Buffer.from(json.html, "utf-8"), customPath };
    }
    if (json.zipBase64 !== undefined) {
      return {
        kind: "zip",
        body: Buffer.from(json.zipBase64, "base64"),
        customPath,
      };
    }
    throw new BadRequest("json body must contain `html` or `zipBase64`");
  }

  if (contentType.startsWith("text/") || contentType === "") {
    const body = Buffer.from(await req.arrayBuffer());
    return { kind: "html", body, customPath: headerPath };
  }

  throw new BadRequest(`unsupported content-type: ${contentType || "<empty>"}`);
}

function enforceSizeLimit(prepared: PreparedBody): void {
  if (prepared.body.length === 0) throw new BadRequest("empty body");
  const limit = prepared.kind === "zip" ? MAX_ZIP_BYTES : MAX_HTML_BYTES;
  if (prepared.body.length > limit) {
    throw new BadRequest(
      `body exceeds limit: ${prepared.body.length} > ${limit}`,
    );
  }
}
