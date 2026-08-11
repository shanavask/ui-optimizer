import type { UIAuditResponse } from "@/types/audit";
import { getFirestoreClient } from "@/lib/firestore-runs";
import { taskIdForPage, taskIdForRedoPage, taskIdForCompetitor } from "@/lib/task-ids";
import { GoogleAuth } from "google-auth-library";

const AUDITS_COLLECTION = "audits";

function browserUseBaseUrl(): string {
  const configuredBaseUrl = process.env.COMPUTER_API?.trim();
  const baseUrl = configuredBaseUrl || "http://localhost:5401";
  return baseUrl.replace(/\/$/, "");
}

function isLocalBrowserUseUrl(baseUrl: string): boolean {
  return baseUrl.startsWith("http://localhost:");
}

async function browserUseAuthHeaders(baseUrl: string): Promise<Record<string, string>> {
  if (isLocalBrowserUseUrl(baseUrl)) {
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
    throw new Error("Unable to obtain Cloud Run ID token for COMPUTER_API.");
  }
  return { Authorization: authorizationHeader };
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function formatBestPractices(bestPractices: string[]): string {
  const rows = bestPractices
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item, index) => `${index + 1}. ${item}`);
  return rows.length > 0 ? rows.join("\n") : "No best practices provided.";
}

function buildBrowserUseTask(pageUrl: string, bestPractices: string): string {
  return `**Role:** You are a Senior UX Auditor. You produce two things: (1) a complete diagnostic rating of every provided best practice, and (2) a prioritized shortlist of exactly **7 problems** where the user experience is less than "Excellent."

**Device Context:** You are operating an **iPhone browser** (mobile Safari on a small-screen device). All evaluations must be based on the **mobile experience** — assess touch targets, font sizes, layout reflow, scrollability, and mobile-specific interactions as seen on a phone screen.

**Important:** The browser is already open and the page at ${pageUrl} is loaded. Do not navigate away from this page, open new tabs, or visit any other URL.

**Objective:** Use the provided best practices as a diagnostic lens. First rate *all* of them. Then surface the 7 most important friction points.

**Evaluation Criteria:**
${bestPractices}

**Operational Protocol:**
1.  **Full Diagnostic Rating:** Evaluate **every** provided best practice and rate its implementation as **Poor**, **Good**, or **Excellent**. Rate all of them — do not skip any, including those rated Excellent.
2.  **Problem Pool:** Any best practice rated **Poor** or **Good** is a candidate "Problem."
3.  **Problem Selection (exactly 7):**
    * Select the 7 problems primarily from the candidate pool. Prioritize **Poor** ratings over **Good**, and the most critical/high-impact issues first.
    * If the candidate pool yields **fewer than 7** problems, supplement with general UX heuristic issues **not covered** by the provided best practices until exactly 7 are reached.
    * If the candidate pool yields **more than 7**, select the 7 highest-impact issues (Poor before Good) and leave the rest in the diagnostic rating only.
4.  **Efficiency:** Use a visual-first approach. Batch interactions (scrolls/clicks) only when necessary to confirm a rating.

**Output Requirements:**

**Section 1 — Best Practice Ratings**
For each provided best practice, one line: the best practice name — **Rating** (Poor / Good / Excellent) — a brief (one-sentence) observation justifying the rating.

**Section 2 — Top 7 Problems**
Exactly 7 problems, in priority order. For each:
1.  **[Problem Name/Headline]**
    * **Rating:** (Poor or Good)
    * **Reference:** (The specific Best Practice used, or "General Heuristic" if found during supplemental analysis)
    * **Observation:** A concise description of the implementation flaw discovered.
    * **Recommendation:** A brief, actionable fix to elevate the implementation to "Excellent."

**Constraints:** No introductory text and no summary "Part" headers beyond the two required sections. Section 1 must be a compact one-line-per-item list. Reserve detailed explanations for Section 2.`;
}

type PageTaskState = {
  audit_status: "completed" | "in_progress";
  audit_result?: string;
};

function withPageTaskState(
  audit: UIAuditResponse,
  states: Map<number, PageTaskState>,
): UIAuditResponse {
  return {
    ...audit,
    pages: audit.pages.map((page, pageIndex) => {
      const state = states.get(pageIndex);
      if (!state) {
        return page;
      }
      return {
        ...page,
        audit_status: state.audit_status,
        ...(state.audit_result ? { audit_result: state.audit_result } : {}),
      };
    }),
  };
}

async function readExistingTaskStates(
  runId: string,
  pageCount: number,
): Promise<Map<number, PageTaskState>> {
  const collection = getFirestoreClient().collection(AUDITS_COLLECTION);
  const lookups = Array.from({ length: pageCount }, (_, pageIndex) =>
    collection.doc(taskIdForPage(runId, pageIndex)).get(),
  );
  const snapshots = await Promise.all(lookups);
  const states = new Map<number, PageTaskState>();
  snapshots.forEach((snapshot, pageIndex) => {
    const result = snapshot.data()?.result;
    if (typeof result === "string" && result.trim()) {
      states.set(pageIndex, { audit_status: "completed", audit_result: result });
    }
  });
  return states;
}

async function submitBrowserUseTask(
  baseUrl: string,
  initialUrl: string,
  task: string,
  taskId: string | undefined,
  signal: AbortSignal,
): Promise<void> {
  const authHeaders = await browserUseAuthHeaders(baseUrl);
  const response = await fetch(`${baseUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      task,
      initial_url: initialUrl,
      ...(taskId ? { task_id: taskId } : {}),
    }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`BrowserUse API ${response.status}: ${detail}`);
  }
}

function buildCompetitorTask(
  competitorName: string,
  competitorUrl: string,
  pageType: string,
): string {
  return (
    `Open the website for ${competitorName} using the url ${competitorUrl}. ` +
    `Navigate to the ${pageType}. ` +
    `Wait for the page to load, close any popups or messages and take a screenshot.`
  );
}

export type CompetitorDispatchResult = {
  dispatched: string[];
  skipped: string[];
  errors: string[];
};

export async function dispatchCompetitorTasks(
  audit: UIAuditResponse,
  runId: string,
  signal: AbortSignal,
): Promise<CompetitorDispatchResult> {
  const baseUrl = browserUseBaseUrl();
  const dispatched: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  await Promise.allSettled(
    audit.pages.flatMap((page, pageIndex) =>
      (audit.competitors ?? []).map(async (competitor, competitorIndex) => {
        const competitorUrl = competitor.competitor_url ? normalizeUrl(competitor.competitor_url) : undefined;
        if (!competitorUrl) {
          skipped.push(`page ${pageIndex} / competitor ${competitorIndex}: no URL`);
          return;
        }
        const task = buildCompetitorTask(competitor.competitor_name, competitorUrl, page.page_type);
        const taskId = taskIdForCompetitor(runId, pageIndex, competitorIndex);
        try {
          await submitBrowserUseTask(baseUrl, competitorUrl, task, taskId, signal);
          dispatched.push(taskId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${taskId}: ${msg}`);
          console.error("Competitor task submission failed", { taskId, error: msg });
        }
      }),
    ),
  );

  return { dispatched, skipped, errors };
}

export async function dispatchRedoScreenshotTask(
  pageUrl: string,
  runId: string,
  pageIndex: number,
  signal: AbortSignal,
): Promise<void> {
  const baseUrl = browserUseBaseUrl();
  const normalizedUrl = normalizeUrl(pageUrl);
  const task = `open the url ${normalizedUrl} and wait for the page to load, close any popups or messages and take a screenshot.`;
  const taskId = taskIdForRedoPage(runId, pageIndex);
  await submitBrowserUseTask(baseUrl, normalizedUrl, task, taskId, signal);
}

export async function dispatchBrowserUseTasks(
  audit: UIAuditResponse,
  signal: AbortSignal,
  runId?: string,
): Promise<UIAuditResponse> {
  const baseUrl = browserUseBaseUrl();
  const states = runId
    ? await readExistingTaskStates(runId, audit.pages.length)
    : new Map<number, PageTaskState>();
  const pending = audit.pages.map(async (page, pageIndex) => {
    if (states.has(pageIndex)) {
      return;
    }
    const pageUrl = normalizeUrl(page.url);
    const task = buildBrowserUseTask(
      pageUrl,
      formatBestPractices(page.best_practices),
    );
    if (runId) {
      states.set(pageIndex, { audit_status: "in_progress" });
    }
    const taskId = runId ? taskIdForPage(runId, pageIndex) : undefined;
    await submitBrowserUseTask(baseUrl, pageUrl, task, taskId, signal);
  });
  const outcomes = await Promise.allSettled(pending);
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      console.error("BrowserUse task submission failed", {
        pageIndex: index,
        error: outcome.reason,
      });
    }
  });
  return withPageTaskState(audit, states);
}
