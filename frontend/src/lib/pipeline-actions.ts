import { GoogleAuth } from "google-auth-library";

import {
  DEFAULT_AGENT_USERNAME,
  auditorAgentBaseUrl,
  fetchGuestimateInSession,
  fetchUiAudit,
  sendPromptInSession,
  sendPromptInSessionWithImage,
} from "@/lib/agent-run";
import {
  getCompetitorArtifacts,
  getSlidesUrl,
  saveAuditRun,
  saveRoiDocumentContent,
} from "@/lib/firestore-runs";
import { slidesApiAuthHeaders, slidesApiBaseUrl } from "@/lib/slidesapi";
import type { UIAuditResponse } from "@/types/audit";

const GENERATE_REPORT_PROMPT = "generate report";

// Deliberately narrower than /api/analyze's combined criteria+dispatch
// behavior: this only regenerates criteria and re-saves the run. The
// pipeline's own "audit" step (dispatchCompetitorTasks/dispatchBrowserUseTasks,
// already exported from lib/browseruse.ts) does the BrowserUse dispatch.
export async function runCriteriaStep(
  runId: string,
  urls: string[],
  signal: AbortSignal,
  username: string = DEFAULT_AGENT_USERNAME,
): Promise<void> {
  const { audit } = await fetchUiAudit(auditorAgentBaseUrl(), urls, signal, username);
  if (!audit) {
    throw new Error("Agent did not return a parseable UI audit response.");
  }
  await saveAuditRun(audit, runId);
}

export async function runGuestimateStep(
  runId: string,
  urls: string[],
  signal: AbortSignal,
  guestimateContext: string = "",
  username: string = DEFAULT_AGENT_USERNAME,
): Promise<string> {
  const guestimate = await fetchGuestimateInSession(
    auditorAgentBaseUrl(),
    urls,
    signal,
    runId,
    guestimateContext,
    username,
  );
  if (!guestimate) {
    throw new Error("Auditor agent did not return content.");
  }
  await saveRoiDocumentContent(runId, guestimate);
  return guestimate;
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

function buildCompetitorAuditPrompt(
  competitorName: string,
  competitorUrl: string,
  pageType: string,
  bestPractices: string[],
): string {
  const criteria = bestPractices.map((bp, i) => `${i + 1}. ${bp}`).join("\n");
  return `run audit for ${competitorName} for the url ${competitorUrl} and page type ${pageType} using the following criteria:\n${criteria}\nusing the screenshot`;
}

export type CompetitorsAuditResult = { dispatched: string[]; skipped: string[]; errors: string[] };

export async function runCompetitorsAuditStep(
  runId: string,
  audit: UIAuditResponse,
  signal: AbortSignal,
  username: string = DEFAULT_AGENT_USERNAME,
): Promise<CompetitorsAuditResult> {
  if (!audit.competitors || audit.competitors.length === 0) {
    return { dispatched: [], skipped: [], errors: [] };
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

        const prompt = buildCompetitorAuditPrompt(
          competitor.competitor_name,
          competitor.competitor_url,
          pageType,
          page.best_practices,
        );

        await sendPromptInSessionWithImage(auditorAgentBaseUrl(), runId, prompt, base64, signal, username);

        dispatched.push(label);
      } catch (err) {
        errors.push(`${label}: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }
  }

  return { dispatched, skipped, errors };
}

export async function runEyeQuantStep(runId: string, pageIndex: number | null = null): Promise<string> {
  const baseUrl = slidesApiBaseUrl();
  const authHeaders = await slidesApiAuthHeaders(baseUrl);
  const eyequantUrl =
    pageIndex !== null
      ? `${baseUrl}/eyequant?run_id=${encodeURIComponent(runId)}&page_id=${pageIndex}`
      : `${baseUrl}/eyequant?run_id=${encodeURIComponent(runId)}`;
  const response = await fetch(eyequantUrl, { method: "GET", headers: { ...authHeaders } });
  const text = (await response.text()).replace(/^"|"$/g, "").trim();
  if (!response.ok) {
    throw new Error(text || `Slides API request failed with ${response.status}`);
  }
  return text;
}

export async function runReportGenerateStep(
  runId: string,
  signal: AbortSignal,
  username: string = DEFAULT_AGENT_USERNAME,
): Promise<void> {
  await sendPromptInSession(auditorAgentBaseUrl(), runId, GENERATE_REPORT_PROMPT, signal, username);
}

export async function runSlidesCreateStep(runId: string, taskIds: string[]): Promise<string> {
  const existing = await getSlidesUrl(runId);
  if (existing) {
    return existing;
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
    throw new Error(text || `Slides API request failed with ${response.status}`);
  }
  const slidesUrl = text.replace(/^"|"$/g, "").trim();
  if (!/^https?:\/\//i.test(slidesUrl)) {
    throw new Error(slidesUrl || "Slides API returned an unexpected response.");
  }
  return slidesUrl;
}
