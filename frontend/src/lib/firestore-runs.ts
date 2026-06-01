import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Firestore, Timestamp } from "@google-cloud/firestore";

import type { UIAuditResponse } from "@/types/audit";

const RUNS_COLLECTION = "runs";
const ROI_COLLECTION = "roi";
const AUDITS_COLLECTION = "audits";
const EYEQUANT_COLLECTION = "eyequant";
const DEFAULT_RUNS_LIMIT = 50;

let firestoreClient: Firestore | null = null;
let cachedDatabaseId: string | null = null;
let cachedProjectId: string | null = null;

export type AuditRunSummary = {
  id: string;
  companyName: string;
  createdAtIso: string;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function parseUIAuditResponse(value: unknown): UIAuditResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as {
    company_name?: unknown;
    vertical?: unknown;
    pages?: unknown;
    message?: unknown;
    guestimate?: unknown;
  };
  if (
    typeof candidate.company_name !== "string" ||
    typeof candidate.vertical !== "string" ||
    !Array.isArray(candidate.pages)
  ) {
    return null;
  }
  const pages = candidate.pages
    .map((page): UIAuditResponse["pages"][number] | null => {
      if (!page || typeof page !== "object") {
        return null;
      }
      const item = page as {
        url?: unknown;
        page_type?: unknown;
        best_practices?: unknown;
        audit_status?: unknown;
        audit_result?: unknown;
        screenshot?: unknown;
        eyeshot?: unknown;
      };
      const auditStatus =
        item.audit_status === "completed" || item.audit_status === "in_progress"
          ? item.audit_status
          : undefined;
      if (
        typeof item.url !== "string" ||
        typeof item.page_type !== "string" ||
        !isStringArray(item.best_practices)
      ) {
        return null;
      }
      return {
        url: item.url,
        page_type: item.page_type,
        best_practices: item.best_practices,
        ...(auditStatus ? { audit_status: auditStatus } : {}),
        ...(typeof item.audit_result === "string"
          ? { audit_result: item.audit_result }
          : {}),
        ...(typeof item.screenshot === "string" ? { screenshot: item.screenshot } : {}),
        ...(typeof item.eyeshot === "string" ? { eyeshot: item.eyeshot } : {}),
      };
    })
    .filter((page): page is UIAuditResponse["pages"][number] => page !== null);

  return {
    company_name: candidate.company_name,
    vertical: candidate.vertical,
    pages,
    message: typeof candidate.message === "string" ? candidate.message : "",
    ...(typeof candidate.guestimate === "string" ? { guestimate: candidate.guestimate } : {}),
  };
}

function sanitizeAuditForRunStorage(audit: UIAuditResponse): UIAuditResponse {
  return {
    ...audit,
    pages: audit.pages.map((page) => ({
      url: page.url,
      page_type: page.page_type,
      best_practices: page.best_practices,
    })),
  };
}

type PageTaskArtifact = {
  audit_status?: "completed" | "in_progress";
  audit_result?: string;
  screenshot?: string;
  eyeshot?: string;
};

function parseTaskArtifact(value: unknown): PageTaskArtifact {
  if (!value || typeof value !== "object") {
    return {};
  }
  const candidate = value as {
    status?: unknown;
    result?: unknown;
    screenshot?: unknown;
  };
  const status =
    candidate.status === "completed" || candidate.status === "in_progress"
      ? candidate.status
      : undefined;
  const result = typeof candidate.result === "string" ? candidate.result : undefined;
  const screenshot = typeof candidate.screenshot === "string" ? candidate.screenshot : undefined;
  const auditStatus = result && result.trim() ? "completed" : status;
  return {
    ...(auditStatus ? { audit_status: auditStatus } : {}),
    ...(result ? { audit_result: result } : {}),
    ...(screenshot ? { screenshot } : {}),
  };
}

function parseEyequantArtifact(value: unknown): PageTaskArtifact {
  if (!value || typeof value !== "object") {
    return {};
  }
  const candidate = value as { eyeshot?: unknown };
  return typeof candidate.eyeshot === "string" ? { eyeshot: candidate.eyeshot } : {};
}

async function getPageTaskArtifacts(
  runId: string,
  pageCount: number,
): Promise<Map<number, PageTaskArtifact>> {
  if (!runId.trim() || pageCount <= 0) {
    return new Map<number, PageTaskArtifact>();
  }
  const collection = getFirestoreClient().collection(AUDITS_COLLECTION);
  const snapshots = await Promise.all(
    Array.from({ length: pageCount }, (_, pageIndex) =>
      collection.doc(`${runId}_page_${pageIndex}`).get(),
    ),
  );
  const artifacts = new Map<number, PageTaskArtifact>();
  snapshots.forEach((snapshot, pageIndex) => {
    if (!snapshot.exists) {
      return;
    }
    const artifact = parseTaskArtifact(snapshot.data());
    if (Object.keys(artifact).length > 0) {
      artifacts.set(pageIndex, artifact);
    }
  });
  return artifacts;
}

async function getPageEyequantArtifacts(
  runId: string,
  pageCount: number,
): Promise<Map<number, PageTaskArtifact>> {
  if (!runId.trim() || pageCount <= 0) {
    return new Map<number, PageTaskArtifact>();
  }
  const collection = getFirestoreClient().collection(EYEQUANT_COLLECTION);
  const snapshots = await Promise.all(
    Array.from({ length: pageCount }, (_, pageIndex) =>
      collection.doc(`${runId}_page_${pageIndex}`).get(),
    ),
  );
  const artifacts = new Map<number, PageTaskArtifact>();
  snapshots.forEach((snapshot, pageIndex) => {
    if (!snapshot.exists) {
      return;
    }
    const artifact = parseEyequantArtifact(snapshot.data());
    if (Object.keys(artifact).length > 0) {
      artifacts.set(pageIndex, artifact);
    }
  });
  return artifacts;
}

function withPageArtifacts(
  audit: UIAuditResponse,
  artifacts: Map<number, PageTaskArtifact>,
): UIAuditResponse {
  if (artifacts.size === 0) {
    return audit;
  }
  return {
    ...audit,
    pages: audit.pages.map((page, pageIndex) => {
      const artifact = artifacts.get(pageIndex);
      if (!artifact) {
        return page;
      }
      return {
        ...page,
        ...(artifact.audit_status ? { audit_status: artifact.audit_status } : {}),
        ...(artifact.audit_result ? { audit_result: artifact.audit_result } : {}),
        ...(artifact.screenshot ? { screenshot: artifact.screenshot } : {}),
        ...(artifact.eyeshot ? { eyeshot: artifact.eyeshot } : {}),
      };
    }),
  };
}

function readEnvValue(
  key: string,
  paths: readonly string[],
): string | null {
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

function envCandidates(): string[] {
  return [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", ".env"),
  ];
}

function firestoreDatabaseId(): string {
  if (cachedDatabaseId) {
    return cachedDatabaseId;
  }
  const runtime = process.env.FIRESTORE_DATABASE_ID?.trim();
  const fromFile = readEnvValue("FIRESTORE_DATABASE_ID", envCandidates());
  const databaseId = runtime || fromFile;
  if (!databaseId) {
    throw new Error(
      "Missing FIRESTORE_DATABASE_ID in runtime environment or .env files",
    );
  }
  cachedDatabaseId = databaseId;
  return cachedDatabaseId;
}

function firestoreProjectId(): string {
  if (cachedProjectId) {
    return cachedProjectId;
  }
  const runtime = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const fromFile = readEnvValue("GOOGLE_CLOUD_PROJECT", envCandidates());
  const projectId = runtime || fromFile;
  if (!projectId) {
    throw new Error(
      "Missing GOOGLE_CLOUD_PROJECT in runtime environment or .env files",
    );
  }
  cachedProjectId = projectId;
  return cachedProjectId;
}

export function getFirestoreClient(): Firestore {
  if (firestoreClient) {
    return firestoreClient;
  }
  firestoreClient = new Firestore({
    projectId: firestoreProjectId(),
    databaseId: firestoreDatabaseId(),
  });
  return firestoreClient;
}

export async function saveAuditRun(
  audit: UIAuditResponse,
  runId?: string,
): Promise<string> {
  const sanitizedAudit = sanitizeAuditForRunStorage(audit);
  const now = Timestamp.now();
  const runDoc = {
    audit: sanitizedAudit,
    source: "run-audit-button",
    updatedAt: now,
  };
  const writeDoc = {
    ...runDoc,
    createdAt: now,
  };
  const payloadBytes = Buffer.byteLength(JSON.stringify(runDoc), "utf8");
  console.info("Saving audit run to Firestore", {
    projectId: firestoreProjectId(),
    databaseId: firestoreDatabaseId(),
    collection: RUNS_COLLECTION,
    pages: sanitizedAudit.pages.length,
    payloadBytes,
    runId,
  });
  try {
    const collection = getFirestoreClient().collection(RUNS_COLLECTION);
    if (runId) {
      const docRef = collection.doc(runId);
      await docRef.set(runDoc, { merge: true });
      console.info("Saved audit run to Firestore", {
        collection: RUNS_COLLECTION,
        documentId: docRef.id,
        mode: "update",
      });
      return docRef.id;
    }
    const docRef = await collection.add(writeDoc);
    console.info("Saved audit run to Firestore", {
      collection: RUNS_COLLECTION,
      documentId: docRef.id,
      mode: "create",
    });
    return docRef.id;
  } catch (error: unknown) {
    const err = error as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
      note?: unknown;
    };
    console.error("Failed saving audit run to Firestore", {
      collection: RUNS_COLLECTION,
      payloadBytes,
      code: err.code,
      details: err.details,
      note: err.note,
      message: err.message,
    });
    throw error;
  }
}

function toAuditRunSummary(
  id: string,
  value: unknown,
): AuditRunSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const doc = value as {
    audit?: { company_name?: unknown };
    createdAt?: unknown;
  };
  const companyName =
    typeof doc.audit?.company_name === "string"
      ? doc.audit.company_name.trim()
      : "";
  if (!companyName) {
    return null;
  }
  const createdAt =
    doc.createdAt instanceof Timestamp ? doc.createdAt.toDate() : new Date(0);
  return {
    id,
    companyName,
    createdAtIso: createdAt.toISOString(),
  };
}

export async function listAuditRuns(
  limit: number = DEFAULT_RUNS_LIMIT,
): Promise<AuditRunSummary[]> {
  const snapshot = await getFirestoreClient()
    .collection(RUNS_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snapshot.docs
    .map((doc) => toAuditRunSummary(doc.id, doc.data()))
    .filter((item): item is AuditRunSummary => item !== null);
}

export async function getAuditRun(runId: string): Promise<UIAuditResponse | null> {
  const snapshot = await getFirestoreClient()
    .collection(RUNS_COLLECTION)
    .doc(runId)
    .get();
  if (!snapshot.exists) {
    return null;
  }
  const data = snapshot.data() as { audit?: unknown } | undefined;
  const audit = parseUIAuditResponse(data?.audit);
  if (!audit) {
    return null;
  }
  const [taskArtifacts, eyequantArtifacts] = await Promise.all([
    getPageTaskArtifacts(runId, audit.pages.length),
    getPageEyequantArtifacts(runId, audit.pages.length),
  ]);
  return withPageArtifacts(withPageArtifacts(audit, taskArtifacts), eyequantArtifacts);
}

export async function deleteAuditRunDocuments(runId: string): Promise<void> {
  const firestore = getFirestoreClient();
  const runRef = firestore.collection(RUNS_COLLECTION).doc(runId);
  const roiRef = firestore.collection(ROI_COLLECTION).doc(runId);
  await Promise.all([runRef.delete(), roiRef.delete()]);
}

function parseRoiDocumentContent(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const doc = value as {
    content?: unknown;
    text?: unknown;
    guestimate?: unknown;
    roi?: unknown;
    value?: unknown;
  };
  const firstTextField =
    typeof doc.content === "string"
      ? doc.content
      : typeof doc.text === "string"
        ? doc.text
        : typeof doc.guestimate === "string"
          ? doc.guestimate
          : typeof doc.roi === "string"
            ? doc.roi
            : typeof doc.value === "string"
              ? doc.value
              : null;
  if (firstTextField && firstTextField.trim()) {
    return firstTextField.trim();
  }
  const asJson = JSON.stringify(value, null, 2);
  return asJson.trim() ? asJson : null;
}

export async function getRoiDocumentContent(runId: string): Promise<string | null> {
  const snapshot = await getFirestoreClient().collection(ROI_COLLECTION).doc(runId).get();
  if (!snapshot.exists) {
    return null;
  }
  return parseRoiDocumentContent(snapshot.data());
}

export async function hasRoiDocument(runId: string): Promise<boolean> {
  const snapshot = await getFirestoreClient().collection(ROI_COLLECTION).doc(runId).get();
  return snapshot.exists;
}

export async function saveRoiDocumentContent(runId: string, content: string): Promise<void> {
  const now = Timestamp.now();
  await getFirestoreClient()
    .collection(ROI_COLLECTION)
    .doc(runId)
    .set({ content, updatedAt: now }, { merge: true });
}
