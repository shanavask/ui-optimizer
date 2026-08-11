import { NextResponse } from "next/server";

import { fetchGuestimateInSession, validateUrlList } from "@/lib/agent-run";
import { saveRoiDocumentContent } from "@/lib/firestore-runs";

const DEFAULT_AUDITOR_AGENT_BASE = "http://127.0.0.1:8001";
const DEFAULT_AGENT_USERNAME = "ui-audit-user";

type GuestimateBody = {
  runId?: unknown;
  urlsText?: unknown;
  guestimateText?: unknown;
  username?: unknown;
};

function auditorAgentBaseUrl(): string {
  const auditorAgent = process.env.AUDITOR_AGENT;
  return auditorAgent?.replace(/\/$/, "") ?? DEFAULT_AUDITOR_AGENT_BASE;
}

function parseBody(
  bodyUnknown: unknown,
): { runId: string; urlsText: string; guestimateText: string; username: string } | { error: string } {
  if (!bodyUnknown || typeof bodyUnknown !== "object") {
    return { error: "Request body must be an object." };
  }
  const body = bodyUnknown as GuestimateBody;
  const runId = typeof body.runId === "string" ? body.runId.trim() : "";
  const urlsText = typeof body.urlsText === "string" ? body.urlsText : "";
  const guestimateText = typeof body.guestimateText === "string" ? body.guestimateText : "";
  if (body.username !== undefined && typeof body.username !== "string") {
    return { error: "username must be a string when provided." };
  }
  const username = body.username?.trim() || DEFAULT_AGENT_USERNAME;
  if (!runId) {
    return { error: "runId is required." };
  }
  if (!urlsText.trim()) {
    return { error: "urlsText is required." };
  }
  return { runId, urlsText, guestimateText, username };
}

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const parsed = parseBody(await request.json());
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const validated = validateUrlList(parsed.urlsText);
    if (!validated.ok) {
      return NextResponse.json(
        { error: validated.error, ...(validated.rejectedUrls && { rejectedUrls: validated.rejectedUrls }) },
        { status: 400 },
      );
    }
    const guestimate = await fetchGuestimateInSession(
      auditorAgentBaseUrl(),
      validated.urls,
      controller.signal,
      parsed.runId,
      parsed.guestimateText,
      parsed.username,
    );
    if (!guestimate) {
      return NextResponse.json(
        { error: "Auditor agent did not return content." },
        { status: 502 },
      );
    }
    await saveRoiDocumentContent(parsed.runId, guestimate);
    return NextResponse.json({ content: guestimate });
  } catch (error: unknown) {
    console.error("Guestimate ROI API failed", error);
    const status = error instanceof Error && error.name === "AbortError" ? 504 : 500;
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to run auditor agent for ROI guestimate.";
    return NextResponse.json({ error: message }, { status });
  } finally {
    clearTimeout(timeout);
  }
}
