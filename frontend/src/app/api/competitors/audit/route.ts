import { NextRequest, NextResponse } from "next/server";

import { getAuditRun, getCompetitorArtifacts, shotsDocumentExists } from "@/lib/firestore-runs";
import { sendPromptInSessionWithImage } from "@/lib/agent-run";
import { GoogleAuth } from "google-auth-library";

export const runtime = "nodejs";

const DEFAULT_AGENT_BASE = "http://127.0.0.1:8001";

function auditorAgentBaseUrl(): string {
  return (process.env.AUDITOR_AGENT ?? DEFAULT_AGENT_BASE).replace(/\/$/, "");
}

async function resolveScreenshotBase64(screenshot: string): Promise<string | null> {
  if (screenshot.startsWith("gs://")) {
    try {
      const withoutScheme = screenshot.slice("gs://".length);
      const slashIndex = withoutScheme.indexOf("/");
      if (slashIndex === -1) return null;
      const bucket = withoutScheme.slice(0, slashIndex);
      const object = withoutScheme.slice(slashIndex + 1);
      const auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/devstorage.read_only"],
      });
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const token = tokenResponse.token;
      if (!token) return null;
      const gcsUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object)}?alt=media`;
      const res = await fetch(gcsUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      return Buffer.from(buf).toString("base64");
    } catch {
      return null;
    }
  }
  if (screenshot.startsWith("data:")) {
    const commaIdx = screenshot.indexOf(",");
    return commaIdx !== -1 ? screenshot.slice(commaIdx + 1) : null;
  }
  return screenshot;
}

function buildAuditPrompt(
  competitorName: string,
  competitorUrl: string,
  pageType: string,
  bestPractices: string[],
): string {
  const criteria = bestPractices.map((bp, i) => `${i + 1}. ${bp}`).join("\n");
  return `run audit for ${competitorName} for the url ${competitorUrl} and page type ${pageType} using the following criteria:\n${criteria}\nusing the screenshot`;
}

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const runId = request.nextUrl.searchParams.get("runId")?.trim();
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const exists = await shotsDocumentExists(runId);
    return NextResponse.json({ exists });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check audit status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type AuditCompetitorsBody = { runId?: unknown };

export async function POST(request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  try {
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as AuditCompetitorsBody;
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const runId = body.runId.trim();

    const audit = await getAuditRun(runId);
    if (!audit) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    if (!audit.competitors || audit.competitors.length === 0) {
      return NextResponse.json({ error: "No competitors configured for this run." }, { status: 400 });
    }

    const artifacts = await getCompetitorArtifacts(runId, audit.pages.length, audit.competitors.length);

    const dispatched: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    const uniquePageTypes = Array.from(new Set(audit.pages.map((p) => p.page_type).filter(Boolean)));

    for (const pageType of uniquePageTypes) {
      const pageIndex = audit.pages.findIndex((p) => p.page_type === pageType);
      const page = audit.pages[pageIndex];
      if (!page) continue;

      for (let ci = 0; ci < audit.competitors.length; ci++) {
        const competitor = audit.competitors[ci];
        const artifact = artifacts[pageIndex]?.[ci];
        const label = `${competitor.competitor_name}/${pageType}`;

        if (!artifact?.screenshot?.trim()) {
          skipped.push(label);
          continue;
        }

        try {
          const base64 = await resolveScreenshotBase64(artifact.screenshot);
          if (!base64) {
            skipped.push(label);
            continue;
          }

          const prompt = buildAuditPrompt(
            competitor.competitor_name,
            competitor.competitor_url,
            pageType,
            page.best_practices,
          );

          await sendPromptInSessionWithImage(
            auditorAgentBaseUrl(),
            runId,
            prompt,
            base64,
            controller.signal,
            "ui-audit-user",
          );

          dispatched.push(label);
        } catch (err) {
          errors.push(`${label}: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }
    }

    return NextResponse.json({ dispatched, skipped, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to audit competitors.";
    console.error("[competitors/audit] request failed", { err });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
