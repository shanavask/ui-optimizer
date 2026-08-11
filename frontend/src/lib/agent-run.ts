import { parseAuditFromAgentEvents, parseTextFromAgentEvents } from "@/lib/audit-events";
import {
  isAllowedAuditUrl,
  parseUrlsFromMultiline,
} from "@/lib/url-input";
import { GoogleAuth } from "google-auth-library";
import type { Competitor, UIAuditResponse } from "@/types/audit";

const APP_NAME = "app";

type SessionCreateResponse = { id: string };
type RunEventsResponse = unknown[];
type JsonObject = Record<string, unknown>;
type PageAudit = UIAuditResponse["pages"][number];

export async function postJson<T>(
  url: string,
  body: unknown,
  signal: AbortSignal,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Agent API ${response.status}: ${detail}`);
  }
  const raw = await response.text();
  if (!raw.trim()) {
    return null as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as T;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function normalizeBase(base: string): string {
  const trimmed = base.trim().replace(/\/$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed.replace(/:(query|streamQuery)$/, "");
  }
  if (trimmed.startsWith("projects/")) {
    const location = process.env.GOOGLE_CLOUD_LOCATION?.trim();
    if (!location) {
      throw new Error("Missing GOOGLE_CLOUD_LOCATION for Agent Runtime endpoint.");
    }
    return `https://${location}-aiplatform.googleapis.com/v1/${trimmed}`;
  }
  if (/^\d+$/.test(trimmed)) {
    const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
    const location = process.env.GOOGLE_CLOUD_LOCATION?.trim();
    if (!project || !location) {
      throw new Error("Missing GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_LOCATION.");
    }
    return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/reasoningEngines/${trimmed}`;
  }
  return trimmed;
}

function isVertexReasoningEngineBase(base: string): boolean {
  return /\/reasoningEngines\/[^/]+$/.test(base);
}

function queryUrl(base: string): string {
  return base.endsWith(":query") ? base : `${base}:query`;
}

function streamQueryUrl(base: string): string {
  return base.endsWith(":streamQuery") ? base : `${base}:streamQuery`;
}

async function authHeaders(base: string): Promise<Record<string, string>> {
  if (!isVertexReasoningEngineBase(base)) {
    return {};
  }
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const token = await auth.getAccessToken();
  if (!token) {
    throw new Error("Unable to get Google Cloud access token for Agent Runtime.");
  }
  return { Authorization: `Bearer ${token}` };
}

function extractSessionId(payload: unknown): string {
  if (!isObject(payload)) {
    throw new Error("Agent Runtime session response is not an object.");
  }
  const output = isObject(payload.output) ? payload.output : undefined;
  const directId = typeof payload.id === "string" ? payload.id : undefined;
  const outputId = output && typeof output.id === "string" ? output.id : undefined;
  const session = output && isObject(output.session) ? output.session : undefined;
  const sessionId = session && typeof session.id === "string" ? session.id : undefined;
  const id = directId ?? outputId ?? sessionId;
  if (!id) {
    throw new Error("Agent Runtime did not return a session id.");
  }
  return id;
}

function extractEvents(payload: unknown): RunEventsResponse {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (typeof payload === "string") {
    const parsed = parseSsePayload(payload);
    if (parsed !== payload) {
      return extractEvents(parsed);
    }
  }
  if (!isObject(payload)) {
    const detail =
      typeof payload === "string" ? payload.slice(0, 300) : JSON.stringify(payload);
    throw new Error(`Agent Runtime response is not parseable: ${detail ?? "empty payload"}`);
  }
  const output = payload.output;
  if (Array.isArray(output)) {
    return output;
  }
  if (isObject(output) && Array.isArray(output.events)) {
    return output.events;
  }
  return [payload];
}

function isPageAudit(value: unknown): value is PageAudit {
  if (!isObject(value)) {
    return false;
  }
  if (typeof value.url !== "string" || typeof value.page_type !== "string") {
    return false;
  }
  if (!Array.isArray(value.best_practices)) {
    return false;
  }
  return value.best_practices.every((item) => typeof item === "string");
}

function parseAuditFromPayload(payload: unknown): UIAuditResponse | null {
  if (typeof payload === "string") {
    try {
      return parseAuditFromPayload(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  if (isObject(payload) && Array.isArray(payload.pages) && payload.pages.every(isPageAudit)) {
    const competitors = Array.isArray(payload.competitors)
      ? (payload.competitors as unknown[])
          .map((c): Competitor | null => {
            if (!isObject(c)) return null;
            if (typeof c.competitor_name !== "string" || typeof c.competitor_url !== "string") return null;
            return { competitor_name: c.competitor_name, competitor_url: c.competitor_url };
          })
          .filter((c): c is Competitor => c !== null)
      : undefined;
    return {
      company_name: typeof payload.company_name === "string" ? payload.company_name : "",
      vertical: typeof payload.vertical === "string" ? payload.vertical : "",
      ...(competitors && competitors.length > 0 ? { competitors } : {}),
      pages: payload.pages,
      message: typeof payload.message === "string" ? payload.message : "",
    };
  }
  if (isObject(payload) && isObject(payload.output)) {
    return parseAuditFromPayload(payload.output);
  }
  if (Array.isArray(payload)) {
    return parseAuditFromAgentEvents(payload);
  }
  return null;
}

function parseTextFromPayload(payload: unknown): string | null {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }
  if (isObject(payload)) {
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim();
    }
    if (typeof payload.output === "string" && payload.output.trim()) {
      return payload.output.trim();
    }
    if (isObject(payload.output)) {
      return parseTextFromPayload(payload.output);
    }
  }
  if (Array.isArray(payload)) {
    return parseTextFromAgentEvents(payload);
  }
  return null;
}

function parseSsePayload(raw: string): unknown {
  const events: unknown[] = [];
  let hasDataPrefix = false;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    hasDataPrefix = true;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      events.push(JSON.parse(payload));
    } catch {
      events.push(payload);
    }
  }
  if (events.length > 0) {
    return events;
  }
  if (hasDataPrefix) {
    return raw;
  }

  const jsonObjects: unknown[] = [];
  const text = raw.trim();
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        try {
          jsonObjects.push(JSON.parse(candidate));
        } catch {
          return raw;
        }
        start = -1;
      } else if (depth < 0) {
        return raw;
      }
    }
  }
  if (jsonObjects.length > 0 && depth === 0 && !inString) {
    return jsonObjects;
  }
  return raw;
}

async function runVertexStreamQuery(
  base: string,
  input: Record<string, string>,
  signal: AbortSignal,
  imageBase64?: string,
): Promise<unknown> {
  const body = imageBase64
    ? { class_method: "async_stream_query", input: { ...input, image_base64: imageBase64 } }
    : { class_method: "async_stream_query", input };
  const response = await fetch(streamQueryUrl(base), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(await authHeaders(base)),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Agent API ${response.status}: ${detail}`);
  }
  const raw = await response.text();
  if (!raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return parseSsePayload(raw);
  }
}

function buildUserPrompt(urls: string[]): string {
  const list = urls.map((u) => `- ${u}`).join("\n");
  return `generate best practices for \n${list}`;
}

function buildGuestimatePrompt(urls: string[], guestimateContext?: string): string {
  const list = urls.map((u) => `- ${u}`).join("\n");
  const context = guestimateContext?.trim();
  if (!context) {
    return `guestimate media metrics for:\n${list}`;
  }
  return `guestimate media metrics for:\n${context}`;
}

export function parseUrlsFromBody(
  bodyUnknown: unknown,
):
  | { ok: true; urlsText: string; saveRun: boolean; runId?: string; username?: string }
  | { ok: false; error: string } {
  if (
    typeof bodyUnknown !== "object" ||
    bodyUnknown === null ||
    typeof (bodyUnknown as { urlsText?: unknown }).urlsText !== "string"
  ) {
    return { ok: false, error: "Request body must include urlsText: string" };
  }
  const saveRunRaw = (bodyUnknown as { saveRun?: unknown }).saveRun;
  if (saveRunRaw !== undefined && typeof saveRunRaw !== "boolean") {
    return { ok: false, error: "saveRun must be a boolean when provided" };
  }
  const runIdRaw = (bodyUnknown as { runId?: unknown }).runId;
  if (runIdRaw !== undefined && typeof runIdRaw !== "string") {
    return { ok: false, error: "runId must be a string when provided" };
  }
  const usernameRaw = (bodyUnknown as { username?: unknown }).username;
  if (usernameRaw !== undefined && typeof usernameRaw !== "string") {
    return { ok: false, error: "username must be a string when provided" };
  }
  const runId = runIdRaw?.trim();
  const username = usernameRaw?.trim();
  return {
    ok: true,
    urlsText: (bodyUnknown as { urlsText: string }).urlsText,
    saveRun: saveRunRaw ?? false,
    ...(runId ? { runId } : {}),
    ...(username ? { username } : {}),
  };
}

export function validateUrlList(
  urlsText: string,
):
  | { ok: true; urls: string[] }
  | { ok: false; error: string; rejectedUrls?: string[] } {
  const urls = parseUrlsFromMultiline(urlsText);
  if (urls.length === 0) {
    return { ok: false, error: "Provide at least one URL" };
  }
  const rejected = urls.filter((u) => !isAllowedAuditUrl(u));
  if (rejected.length > 0) {
    return {
      ok: false,
      error: "Each URL must be a valid http or https URL.",
      rejectedUrls: rejected,
    };
  }
  return { ok: true, urls };
}

async function createAgentSession(
  base: string,
  userId: string,
  signal: AbortSignal,
): Promise<SessionCreateResponse> {
  const resolvedBase = normalizeBase(base);
  if (isVertexReasoningEngineBase(resolvedBase)) {
    const payload = await postJson<unknown>(
      queryUrl(resolvedBase),
      { class_method: "async_create_session", input: { user_id: userId } },
      signal,
      await authHeaders(resolvedBase),
    );
    return { id: extractSessionId(payload) };
  }
  return postJson<SessionCreateResponse>(
    `${resolvedBase}/apps/${APP_NAME}/users/${userId}/sessions`,
    { state: {} },
    signal,
  );
}

function runRequestBody(
  userId: string,
  sessionId: string,
  prompt: string,
): Record<string, unknown> {
  return {
    app_name: APP_NAME,
    user_id: userId,
    session_id: sessionId,
    new_message: {
      role: "user",
      parts: [{ text: prompt }],
    },
  };
}

export async function fetchUiAudit(
  base: string,
  urls: string[],
  signal: AbortSignal,
  username?: string,
): Promise<{ audit: UIAuditResponse | null; sessionId: string }> {
  const resolvedBase = normalizeBase(base);
  const userId = username?.trim() || crypto.randomUUID();
  const session = await createAgentSession(resolvedBase, userId, signal);
  const body = runRequestBody(userId, session.id, buildUserPrompt(urls));
  if (isVertexReasoningEngineBase(resolvedBase)) {
    const payload = await runVertexStreamQuery(
      resolvedBase,
      {
        user_id: userId,
        session_id: session.id,
        message: buildUserPrompt(urls),
      },
      signal,
    );
    const parsed = parseAuditFromPayload(payload);
    if (parsed) {
      return { audit: parsed, sessionId: session.id };
    }
    return { audit: parseAuditFromAgentEvents(extractEvents(payload)), sessionId: session.id };
  }
  const events = await postJson<RunEventsResponse>(`${resolvedBase}/run`, body, signal);
  return { audit: parseAuditFromAgentEvents(events), sessionId: session.id };
}

export async function sendAgentPrompt(
  base: string,
  prompt: string,
  signal: AbortSignal,
  username?: string,
): Promise<void> {
  const resolvedBase = normalizeBase(base);
  const userId = username?.trim() || crypto.randomUUID();
  const session = await createAgentSession(resolvedBase, userId, signal);
  const body = runRequestBody(userId, session.id, prompt);
  if (isVertexReasoningEngineBase(resolvedBase)) {
    await runVertexStreamQuery(
      resolvedBase,
      {
        user_id: userId,
        session_id: session.id,
        message: prompt,
      },
      signal,
    );
    return;
  }
  await postJson<RunEventsResponse>(`${resolvedBase}/run`, body, signal);
}

export async function fetchGuestimate(
  base: string,
  urls: string[],
  signal: AbortSignal,
  guestimateContext?: string,
  username?: string,
): Promise<string | null> {
  const resolvedBase = normalizeBase(base);
  const userId = username?.trim() || crypto.randomUUID();
  const session = await createAgentSession(resolvedBase, userId, signal);
  const prompt = buildGuestimatePrompt(urls, guestimateContext);
  const body = runRequestBody(userId, session.id, prompt);
  if (isVertexReasoningEngineBase(resolvedBase)) {
    const payload = await runVertexStreamQuery(
      resolvedBase,
      {
        user_id: userId,
        session_id: session.id,
        message: prompt,
      },
      signal,
    );
    return parseTextFromPayload(payload);
  }
  const events = await postJson<RunEventsResponse>(`${resolvedBase}/run`, body, signal);
  const text = parseTextFromAgentEvents(events);
  return text?.trim() ? text : null;
}

export async function fetchGuestimateInSession(
  base: string,
  urls: string[],
  signal: AbortSignal,
  sessionId: string,
  guestimateContext?: string,
  username?: string,
): Promise<string | null> {
  const resolvedBase = normalizeBase(base);
  const userId = username?.trim() || crypto.randomUUID();
  const prompt = buildGuestimatePrompt(urls, guestimateContext);
  const body = runRequestBody(userId, sessionId, prompt);
  if (isVertexReasoningEngineBase(resolvedBase)) {
    const payload = await runVertexStreamQuery(
      resolvedBase,
      { user_id: userId, session_id: sessionId, message: prompt },
      signal,
    );
    return parseTextFromPayload(payload);
  }
  const events = await postJson<RunEventsResponse>(`${resolvedBase}/run`, body, signal);
  const text = parseTextFromAgentEvents(events);
  return text?.trim() ? text : null;
}

export function buildRememberPrompt(
  vertical: string,
  pageType: string,
  bestPractices: string,
): string {
  return `Remember this:\nVertical: ${vertical}\nPage Type: ${pageType}\nBest Practices: ${bestPractices}`;
}

export async function sendPromptInSession(
  base: string,
  sessionId: string,
  prompt: string,
  signal: AbortSignal,
  username?: string,
): Promise<void> {
  const resolvedBase = normalizeBase(base);
  const userId = username?.trim() || crypto.randomUUID();
  const body = runRequestBody(userId, sessionId, prompt);
  if (isVertexReasoningEngineBase(resolvedBase)) {
    await runVertexStreamQuery(resolvedBase, { user_id: userId, session_id: sessionId, message: prompt }, signal);
    return;
  }
  await postJson<RunEventsResponse>(`${resolvedBase}/run`, body, signal);
}

export async function sendPromptInSessionWithImage(
  base: string,
  sessionId: string,
  prompt: string,
  imageBase64: string,
  signal: AbortSignal,
  username?: string,
): Promise<void> {
  const resolvedBase = normalizeBase(base);
  const userId = username?.trim() || crypto.randomUUID();
  const body = {
    app_name: APP_NAME,
    user_id: userId,
    session_id: sessionId,
    new_message: {
      role: "user",
      parts: [
        { text: prompt },
        { inline_data: { mime_type: "image/png", data: imageBase64 } },
      ],
    },
  };
  if (isVertexReasoningEngineBase(resolvedBase)) {
    await runVertexStreamQuery(
      resolvedBase,
      { user_id: userId, session_id: sessionId, message: prompt },
      signal,
      imageBase64,
    );
    return;
  }
  await postJson<RunEventsResponse>(`${resolvedBase}/run`, body, signal);
}

export async function fetchRememberThis(
  base: string,
  vertical: string,
  pageType: string,
  bestPractices: string,
  signal: AbortSignal,
  username?: string,
  sessionId?: string,
): Promise<void> {
  const prompt = buildRememberPrompt(vertical, pageType, bestPractices);
  if (!sessionId) {
    await sendAgentPrompt(base, prompt, signal, username);
    return;
  }
  const resolvedBase = normalizeBase(base);
  const userId = username?.trim() || crypto.randomUUID();
  const body = runRequestBody(userId, sessionId, prompt);
  if (isVertexReasoningEngineBase(resolvedBase)) {
    await runVertexStreamQuery(resolvedBase, { user_id: userId, session_id: sessionId, message: prompt }, signal);
    return;
  }
  await postJson<RunEventsResponse>(`${resolvedBase}/run`, body, signal);
}
