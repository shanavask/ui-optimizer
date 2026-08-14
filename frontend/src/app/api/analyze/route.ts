import { NextResponse } from "next/server";

import {
  auditorAgentBaseUrl,
  fetchGuestimate,
  fetchUiAudit,
  parseUrlsFromBody,
  validateUrlList,
} from "@/lib/agent-run";
import { dispatchBrowserUseTasks } from "@/lib/browseruse";
import { saveAuditRun } from "@/lib/firestore-runs";

export const runtime = "nodejs";

type MaybeError = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  details?: unknown;
};

function invalidUrlsResponse(error: string, rejectedUrls?: string[]): Response {
  return NextResponse.json(
    { error, ...(rejectedUrls && { rejectedUrls }) },
    { status: 400 },
  );
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  if (typeof err === "string" && err.trim()) {
    return err;
  }
  if (typeof err === "object" && err !== null) {
    const e = err as MaybeError;
    const name = typeof e.name === "string" ? e.name : undefined;
    const code =
      typeof e.code === "string" || typeof e.code === "number"
        ? `${e.code}`
        : undefined;
    const details = typeof e.details === "string" ? e.details : undefined;
    const message = typeof e.message === "string" ? e.message : undefined;
    const combined = [name, code, details, message].filter(Boolean).join(" | ");
    if (combined.trim()) {
      return combined;
    }
  }
  return "Unexpected error calling agent";
}

async function runAnalyze(
  urlsText: string,
  signal: AbortSignal,
  saveRun: boolean,
  username?: string,
  runId?: string,
): Promise<Response> {
  const validated = validateUrlList(urlsText);
  if (!validated.ok) {
    return invalidUrlsResponse(validated.error, validated.rejectedUrls);
  }
  const { audit, sessionId } = await fetchUiAudit(auditorAgentBaseUrl(), validated.urls, signal, username);
  if (!audit) {
    return NextResponse.json(
      { error: "Agent did not return a parseable UI audit response." },
      { status: 502 },
    );
  }
  const guestimate = saveRun
    ? await fetchGuestimate(auditorAgentBaseUrl(), validated.urls, signal, undefined, username)
    : undefined;
  const auditWithGuestimate = {
    ...audit,
    ...(guestimate ? { guestimate } : {}),
  };
  const savedRunId = saveRun ? await saveAuditRun(auditWithGuestimate, sessionId) : undefined;
  let nextAudit = auditWithGuestimate;
  if (saveRun) {
    nextAudit = await dispatchBrowserUseTasks(auditWithGuestimate, signal, savedRunId);
  }
  return NextResponse.json({
    audit: nextAudit,
    runId: savedRunId ?? sessionId,
  });
}

export async function POST(request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  try {
    const bodyUnknown: unknown = await request.json();
    const parsed = parseUrlsFromBody(bodyUnknown);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    return await runAnalyze(
      parsed.urlsText,
      controller.signal,
      parsed.saveRun,
      parsed.username,
      parsed.runId,
    );
  } catch (err) {
    console.error("Analyze API failed", err);
    const message = toErrorMessage(err);
    const status = err instanceof Error && err.name === "AbortError" ? 504 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    clearTimeout(timeout);
  }
}
