import { proxyToSlidesApi } from "@/lib/backend-proxy";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  return proxyToSlidesApi("/report/generate", { method: "POST", body, signal: request.signal });
}
