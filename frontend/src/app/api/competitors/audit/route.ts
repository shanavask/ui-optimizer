import { proxyToSlidesApi } from "@/lib/backend-proxy";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  return proxyToSlidesApi("/competitors/audit", { method: "GET", searchParams });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  return proxyToSlidesApi("/competitors/audit", { method: "POST", body, signal: request.signal });
}
