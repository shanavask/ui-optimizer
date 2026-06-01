import type { PageAudit, UIAuditResponse } from "@/types/audit";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPageAudit(value: unknown): value is PageAudit {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.url !== "string" || typeof value.page_type !== "string") {
    return false;
  }
  if (!Array.isArray(value.best_practices)) {
    return false;
  }
  return value.best_practices.every((p) => typeof p === "string");
}

function normalizeAuditResponse(value: unknown): UIAuditResponse | null {
  if (!isRecord(value) || typeof value.vertical !== "string") {
    return null;
  }
  if (!Array.isArray(value.pages) || !value.pages.every(isPageAudit)) {
    return null;
  }
  return {
    company_name: typeof value.company_name === "string" ? value.company_name : "",
    vertical: value.vertical,
    pages: value.pages,
    message: typeof value.message === "string" ? value.message : "",
  };
}

function tryParseAuditText(text: string): UIAuditResponse | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return normalizeAuditResponse(parsed);
  } catch {
    return null;
  }
}

function collectTextFromEvent(event: unknown): string {
  if (!isRecord(event) || !isRecord(event.content)) {
    return "";
  }
  const parts = event.content.parts;
  if (!Array.isArray(parts)) {
    return "";
  }
  const texts: string[] = [];
  for (const part of parts) {
    if (isRecord(part) && typeof part.text === "string" && part.text) {
      texts.push(part.text);
    }
  }
  return texts.join("\n");
}

export function parseTextFromAgentEvents(events: unknown[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const combined = collectTextFromEvent(events[i]);
    if (combined.trim()) {
      return combined;
    }
  }
  return null;
}

export function parseAuditFromAgentEvents(
  events: unknown[],
): UIAuditResponse | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    const combined = collectTextFromEvent(event);
    const fromCombined = tryParseAuditText(combined);
    if (fromCombined) {
      return fromCombined;
    }
    if (!isRecord(event) || !isRecord(event.content)) {
      continue;
    }
    const parts = event.content.parts;
    if (!Array.isArray(parts)) {
      continue;
    }
    for (const part of parts) {
      if (isRecord(part) && typeof part.text === "string") {
        const single = tryParseAuditText(part.text);
        if (single) {
          return single;
        }
      }
    }
  }
  return null;
}
