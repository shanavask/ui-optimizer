import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { GoogleAuth } from "google-auth-library";

const DEFAULT_SLIDES_API = "http://127.0.0.1:5402";

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

export function slidesApiBaseUrl(): string {
  const runtime = process.env.SLIDES_API?.trim();
  const fromFile = readEnvValue("SLIDES_API", [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
  ]);
  const rawBaseUrl = (runtime || fromFile || DEFAULT_SLIDES_API).trim();
  const withScheme = /^https?:\/\//i.test(rawBaseUrl) ? rawBaseUrl : `http://${rawBaseUrl}`;
  return withScheme.replace(/\/$/, "");
}

export function isLocalSlidesUrl(baseUrl: string): boolean {
  return baseUrl.startsWith("http://localhost:") || baseUrl.startsWith("http://127.0.0.1:");
}

export async function slidesApiAuthHeaders(baseUrl: string): Promise<Record<string, string>> {
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
