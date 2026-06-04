import { fetchBlobContent } from "@/lib/blob";
import { publishedKey, readMeta } from "@/lib/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ path: string[] }> };

export async function GET(_req: Request, { params }: RouteParams): Promise<Response> {
  const { path: segments } = await params;
  if (segments.length === 0) return notFound();

  const sitePath = segments[0];
  const filePath = segments.slice(1).join("/") || "index.html";

  const meta = await readMeta(sitePath);
  if (!meta) return notFound();
  if (meta.status !== "published") return notFound();

  const content = await fetchBlobContent(publishedKey(sitePath, filePath));
  if (!content) {
    if (filePath === "index.html") return notFound();
    return new Response("Not Found", { status: 404 });
  }

  return new Response(content.body, {
    headers: {
      "content-type": content.contentType,
      "cache-control": "private, max-age=0, must-revalidate",
    },
  });
}

function notFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
