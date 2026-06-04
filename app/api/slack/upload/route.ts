import { verifySlack } from "@/lib/auth";
import { BadRequest, toJsonError } from "@/lib/errors";
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
    const fileUrl = params.get("file_url") ?? extractFirstUrl(text);

    let kind: "html" | "zip";
    let body: Buffer;

    if (fileUrl) {
      const fetched = await fetchSlackFile(fileUrl);
      kind = fetched.kind;
      body = fetched.body;
    } else {
      const inlineHtml = text.trim();
      if (!inlineHtml) {
        throw new BadRequest(
          "no html / file. Use: /sandbox [custom-path] <html or file URL>",
        );
      }
      kind = "html";
      body = Buffer.from(inlineHtml, "utf-8");
    }

    const customPath = extractCustomPath(text);
    const result = await performUpload({
      identity,
      customPath,
      content: { kind, body },
    });

    return Response.json({
      response_type: "ephemeral",
      text: `:white_check_mark: published <${result.url}|${result.path}>`,
    });
  } catch (err) {
    return toJsonError(err);
  }
}

function extractFirstUrl(text: string): string | null {
  const m = /https?:\/\/[^\s<>|]+/.exec(text);
  return m ? m[0] : null;
}

function extractCustomPath(text: string): string | undefined {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length === 0) return undefined;
  const first = tokens[0];
  if (/^[a-z0-9][a-z0-9_-]{1,63}$/.test(first)) {
    return first;
  }
  return undefined;
}

async function fetchSlackFile(url: string): Promise<{ kind: "html" | "zip"; body: Buffer }> {
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
