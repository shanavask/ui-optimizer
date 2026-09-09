import { NextResponse } from "next/server";

import { slidesApiAuthHeaders, slidesApiBaseUrl } from "@/lib/slidesapi";

type ProxyInit = {
  method: string;
  body?: unknown;
  searchParams?: URLSearchParams;
  signal?: AbortSignal;
};

function buildUrl(baseUrl: string, path: string, searchParams?: URLSearchParams): string {
  const query = searchParams && searchParams.toString() ? `?${searchParams.toString()}` : "";
  return `${baseUrl}${path}${query}`;
}

/** Generic JSON-in/JSON-out proxy to the Python backend (apis/slidesapi). */
export async function proxyToSlidesApi(path: string, init: ProxyInit): Promise<Response> {
  const baseUrl = slidesApiBaseUrl();
  const authHeaders = await slidesApiAuthHeaders(baseUrl);
  const response = await fetch(buildUrl(baseUrl, path, init.searchParams), {
    method: init.method,
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...authHeaders,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: init.signal,
  });
  const text = await response.text();
  return new NextResponse(text, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
  });
}

/** Binary proxy (e.g. GCS image bytes) - no JSON re-encoding of the body. */
export async function proxyToSlidesApiBinary(path: string, init: ProxyInit): Promise<Response> {
  const baseUrl = slidesApiBaseUrl();
  const authHeaders = await slidesApiAuthHeaders(baseUrl);
  const response = await fetch(buildUrl(baseUrl, path, init.searchParams), {
    method: init.method,
    headers: authHeaders,
    signal: init.signal,
  });
  if (!response.ok) {
    const text = await response.text();
    return new NextResponse(text, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  }
  const buffer = await response.arrayBuffer();
  return new NextResponse(buffer, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": response.headers.get("Cache-Control") ?? "private, max-age=3600",
    },
  });
}
