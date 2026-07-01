import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { GoogleAuth } from "google-auth-library";
import { NextResponse } from "next/server";

const DEFAULT_SLIDES_API = "http://127.0.0.1:5402";

type EyeQuantBody = { runId?: unknown; pageIndex?: unknown };

function readEnvValue(key: string, paths: readonly string[]): string | null {
  for (const candidate of paths) {
    if (!existsSync(candidate)) {
      continue;
    }
    const content = readFileSync(candidate, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const [rawKey, ...rawValue] = trimmed.split("=");
      if (rawKey?.trim() !== key) {
        continue;
      }
      const value = rawValue.join("=").trim().replace(/^['"]|['"]$/g, "");
      return value || null;
    }
  }
  return null;
}

function slidesApiBaseUrl(): string {
  const runtime = process.env.SLIDES_API?.trim();
  const fromFile = readEnvValue("SLIDES_API", [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
  ]);
  const rawBaseUrl = (runtime || fromFile || DEFAULT_SLIDES_API).trim();
  const withScheme = /^https?:\/\//i.test(rawBaseUrl)
    ? rawBaseUrl
    : `http://${rawBaseUrl}`;
  return withScheme.replace(/\/$/, "");
}

function isLocalSlidesUrl(baseUrl: string): boolean {
  return baseUrl.startsWith("http://localhost:") || baseUrl.startsWith("http://127.0.0.1:");
}

async function slidesApiAuthHeaders(baseUrl: string): Promise<Record<string, string>> {
  if (isLocalSlidesUrl(baseUrl)) {
    return {};
  }
  const configuredToken = process.env.ID_TOKEN?.trim();
  if (configuredToken) {
    return { Authorization: `Bearer ${configuredToken}` };
  }
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(baseUrl);
  const tokenHeaders = await client.getRequestHeaders();
  const authorizationHeader = tokenHeaders.get("Authorization") ?? tokenHeaders.get("authorization");
  if (!authorizationHeader) {
    throw new Error("Unable to obtain Cloud Run ID token for SLIDES_API.");
  }
  return { Authorization: authorizationHeader };
}

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const requestId = `eyequant-${Date.now()}`;
  try {
    console.info("[slides/eyequant] request received", { requestId });
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      console.warn("[slides/eyequant] invalid body", {
        requestId,
        bodyType: typeof bodyUnknown,
      });
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as EyeQuantBody;
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      console.warn("[slides/eyequant] missing runId", {
        requestId,
        runIdType: typeof body.runId,
      });
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const runId = body.runId.trim();
    const pageIndex = typeof body.pageIndex === "number" ? body.pageIndex : null;
    const baseUrl = slidesApiBaseUrl();
    console.info("[slides/eyequant] preparing upstream request", {
      requestId,
      runId,
      baseUrl,
      isLocal: isLocalSlidesUrl(baseUrl),
    });
    const authHeaders = await slidesApiAuthHeaders(baseUrl);
    console.info("[slides/eyequant] auth headers resolved", {
      requestId,
      hasAuthorization: typeof authHeaders.Authorization === "string",
    });
    const eyequantUrl = pageIndex !== null
      ? `${baseUrl}/eyequant?run_id=${encodeURIComponent(runId)}&page_id=${pageIndex}`
      : `${baseUrl}/eyequant?run_id=${encodeURIComponent(runId)}`;
    const response = await fetch(
      eyequantUrl,
      {
        method: "GET",
        headers: { ...authHeaders },
      },
    );
    const text = (await response.text()).replace(/^"|"$/g, "").trim();
    console.info("[slides/eyequant] upstream response", {
      requestId,
      runId,
      status: response.status,
      ok: response.ok,
      bodyPreview: text.slice(0, 300),
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: text || `Slides API request failed with ${response.status}` },
        { status: response.status },
      );
    }
    return NextResponse.json({ status: text });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to run EyeQuant.";
    console.error("[slides/eyequant] request failed", {
      requestId,
      message,
      error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
