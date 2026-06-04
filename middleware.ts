import { NextResponse, type NextRequest } from "next/server";
import { clientIpFromHeaders, isAllowed, parseAllowList } from "@/lib/ip";

const RULES = parseAllowList(process.env.ALLOWED_IPS);

export function middleware(req: NextRequest): NextResponse {
  const ip = clientIpFromHeaders(req.headers);
  if (isAllowed(ip, RULES)) {
    return NextResponse.next();
  }
  return new NextResponse("Forbidden", {
    status: 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export const config = {
  matcher: [
    "/((?!api/|_next/|favicon.ico$|robots.txt$|$).*)",
  ],
};
