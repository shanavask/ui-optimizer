import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { GoogleAuth } from "google-auth-library";
import { NextResponse } from "next/server";

import { getFirestoreClient } from "@/lib/firestore-runs";

const DEFAULT_SLIDES_API = "http://127.0.0.1:5402";

type CreateSlidesBody = { taskIds?: unknown; runId?: unknown };

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

function parseTaskIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const taskIds = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return taskIds.length > 0 ? taskIds : null;
}

async function getExistingSlidesUrl(runId: string): Promise<string | null> {
  const snapshot = await getFirestoreClient().collection("slides").doc(runId).get();
  if (!snapshot.exists) {
    return null;
  }
  const data = snapshot.data() as { slides_url?: unknown } | undefined;
  const slidesUrl =
    typeof data?.slides_url === "string" ? data.slides_url.trim() : "";
  return slidesUrl || null;
}

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId")?.trim();
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const slidesUrl = await getExistingSlidesUrl(runId);
    return NextResponse.json({ slidesUrl: slidesUrl ?? null });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to fetch slides URL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as CreateSlidesBody;
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const runId = body.runId.trim();
    const taskIds = parseTaskIds(body.taskIds);
    if (!taskIds) {
      return NextResponse.json(
        { error: "taskIds must be a non-empty string array." },
        { status: 400 },
      );
    }

    const existingSlidesUrl = await getExistingSlidesUrl(runId);
    if (existingSlidesUrl) {
      return NextResponse.json({ slidesUrl: existingSlidesUrl, fromFirestore: true });
    }

    const baseUrl = slidesApiBaseUrl();
    const authHeaders = await slidesApiAuthHeaders(baseUrl);
    const response = await fetch(`${baseUrl}/create_slides`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(taskIds),
    });
    const text = await response.text();
    if (!response.ok) {
      return NextResponse.json(
        { error: text || `Slides API request failed with ${response.status}` },
        { status: response.status },
      );
    }
    const slidesUrl = text.replace(/^"|"$/g, "").trim();
    // The Slides API can return 200 OK with an error message as the body instead of a real URL.
    if (!/^https?:\/\//i.test(slidesUrl)) {
      return NextResponse.json(
        { error: slidesUrl || "Slides API returned an unexpected response." },
        { status: 502 },
      );
    }
    return NextResponse.json({ slidesUrl });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to create slides.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
