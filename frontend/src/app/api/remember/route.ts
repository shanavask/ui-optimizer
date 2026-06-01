import { NextResponse } from "next/server";

import { fetchRememberThis } from "@/lib/agent-run";

const DEFAULT_AGENT_BASE = "http://127.0.0.1:8001";
export const runtime = "nodejs";

type RememberBody = {
  vertical?: unknown;
  pageType?: unknown;
  bestPractices?: unknown;
  username?: unknown;
};

function agentBaseUrl(): string {
  const criteriaAgent = process.env.CRITERIA_AGENT;
  return criteriaAgent?.replace(/\/$/, "") ?? DEFAULT_AGENT_BASE;
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function parseRememberBody(bodyUnknown: unknown):
  | { ok: true; vertical: string; pageType: string; bestPractices: string; username?: string }
  | { ok: false; error: string } {
  if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
    return { ok: false, error: "Request body must be an object." };
  }
  const body = bodyUnknown as RememberBody;
  if (
    typeof body.vertical !== "string" ||
    typeof body.pageType !== "string" ||
    typeof body.bestPractices !== "string"
  ) {
    return {
      ok: false,
      error: "Request body must include vertical, pageType, and bestPractices strings.",
    };
  }
  if (isBlank(body.vertical) || isBlank(body.pageType) || isBlank(body.bestPractices)) {
    return {
      ok: false,
      error: "vertical, pageType, and bestPractices are required.",
    };
  }
  if (body.username !== undefined && typeof body.username !== "string") {
    return { ok: false, error: "username must be a string when provided." };
  }
  const username = body.username?.trim();
  return {
    ok: true,
    vertical: body.vertical.trim(),
    pageType: body.pageType.trim(),
    bestPractices: body.bestPractices.trim(),
    ...(username ? { username } : {}),
  };
}

export async function POST(request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const bodyUnknown: unknown = await request.json();
    const parsed = parseRememberBody(bodyUnknown);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    await fetchRememberThis(
      agentBaseUrl(),
      parsed.vertical,
      parsed.pageType,
      parsed.bestPractices,
      controller.signal,
      parsed.username,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Failed to save memory.";
    return NextResponse.json({ error: detail }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
