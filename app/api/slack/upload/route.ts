import { verifySlack } from "@/lib/auth";
import { BadRequest, HttpError } from "@/lib/errors";
import { parseSlackText } from "@/lib/slack-text";
import { performUpload } from "@/lib/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const rawBody = await req.text();
    const identity = await verifySlack(req, rawBody);
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
      throw new BadRequest(
        "no html / file. Usage: /sandbox [custom-path] <html or file URL>",
      );
    }

    const result = await performUpload({
      identity,
      customPath: parsed.customPath,
      content: { kind, body },
    });

    return Response.json({
      response_type: "ephemeral",
      text: `:white_check_mark: published <${result.url}|${result.path}>`,
    });
  } catch (err) {
    return slackError(err);
  }
}

async function fetchSlackFile(
  url: string,
): Promise<{ kind: "html" | "zip"; body: Buffer }> {
  const headers: HeadersInit = {};
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (slackToken && url.startsWith("https://files.slack.com")) {
    headers.authorization = `Bearer ${slackToken}`;
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

function slackError(err: unknown): Response {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof HttpError ? err.message : "internal error";
  if (!(err instanceof HttpError)) console.error("[sandbox/slack] error", err);
  return Response.json(
    { response_type: "ephemeral", text: `:x: ${message}` },
    { status },
  );
}
