import type { UIAuditResponse } from "@/types/audit";
import { getFirestoreClient } from "@/lib/firestore-runs";
import { taskIdForPage } from "@/lib/task-ids";
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

function formatBestPractices(bestPractices: string[]): string {
  const rows = bestPractices
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item, index) => `${index + 1}. ${item}`);
  return rows.length > 0 ? rows.join("\n") : "No best practices provided.";
}

function buildBrowserUseTask(pageUrl: string, bestPractices: string): string {
  return `**Role:** You are a Senior UX Auditor. Your goal is to identify exactly **7 implementation problems** on a webpage where the user experience is less than "Excellent."

**Objective:** Use the provided best practices as a diagnostic lens to find 7 friction points. 

**Evaluation Criteria:**
${bestPractices}

**Operational Protocol:**
1.  **Diagnostic Rating:** For each provided best practice, evaluate the implementation as **Poor**, **Good**, or **Excellent**. 
2.  **Problem Selection:** Any implementation rated **Poor** or **Good** is considered a "Problem." 
3.  **Quota Fulfillment:** * If the provided best practices yield fewer than 7 problems, perform a general UX heuristic analysis to identify additional issues until exactly **7 problems** are reached.
    * Prioritize the most critical "Poor" ratings first.
4.  **Efficiency:** Use a visual-first approach. Batch interactions (scrolls/clicks) only when necessary to confirm a "Poor" or "Good" rating.

**Output Requirements:**
Provide a list of exactly **7 problems**. For each, include:

1.  **[Problem Name/Headline]**
    * **Rating:** (Poor or Good)
    * **Reference:** (The specific Best Practice used, or "General Heuristic" if found during the supplemental analysis)
    * **Observation:** A concise description of the implementation flaw discovered.
    * **Recommendation:** A brief actionable fix to elevate the implementation to "Excellent."

**Constraint:** Do not include introductory text, summary tables, or "Part" headers. Provide detailed explanations for observations and recommendations. Output only the 7 problems.`;
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
    const pageUrl = page.url.trim();
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
