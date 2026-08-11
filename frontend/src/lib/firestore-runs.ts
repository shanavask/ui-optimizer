import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Firestore, Timestamp } from "@google-cloud/firestore";

import type { Competitor, CompetitorArtifact, SlideMediaMetrics, SlideReport, SlideFinding, SlideRecommendation, UIAuditResponse } from "@/types/audit";
import { taskIdForCompetitor } from "@/lib/task-ids";

const RUNS_COLLECTION = "runs";
const ROI_COLLECTION = "roi";
const AUDITS_COLLECTION = "audits";
const EYEQUANT_COLLECTION = "eyequant";
const REPORTS_COLLECTION = "reports";
const SHOTS_COLLECTION = "shots";
const DEFAULT_RUNS_LIMIT = 10;

let firestoreClient: Firestore | null = null;
let cachedDatabaseId: string | null = null;
let cachedProjectId: string | null = null;

export type AuditRunSummary = {
  id: string;
  companyName: string;
  createdAtIso: string;
  updatedAtIso: string;
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
    competitors?: unknown;
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
  const competitors = Array.isArray(candidate.competitors)
    ? (candidate.competitors as unknown[])
        .map((c): Competitor | null => {
          if (!c || typeof c !== "object") return null;
          const ci = c as { competitor_name?: unknown; competitor_url?: unknown };
          if (typeof ci.competitor_name !== "string" || typeof ci.competitor_url !== "string") return null;
          return { competitor_name: ci.competitor_name, competitor_url: ci.competitor_url };
        })
        .filter((c): c is Competitor => c !== null)
    : undefined;
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
        clarity?: unknown;
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
        ...(typeof item.clarity === "string" ? { clarity: item.clarity } : {}),
      };
    })
    .filter((page): page is UIAuditResponse["pages"][number] => page !== null);

  return {
    company_name: candidate.company_name,
    vertical: candidate.vertical,
    ...(competitors && competitors.length > 0 ? { competitors } : {}),
    pages,
    message: typeof candidate.message === "string" ? candidate.message : "",
    ...(typeof candidate.guestimate === "string" ? { guestimate: candidate.guestimate } : {}),
  };
}

function sanitizeAuditForRunStorage(audit: UIAuditResponse): UIAuditResponse {
  return {
    company_name: audit.company_name,
    vertical: audit.vertical,
    ...(audit.competitors && audit.competitors.length > 0 ? { competitors: audit.competitors } : {}),
    pages: audit.pages.map((page) => ({
      url: page.url,
      page_type: page.page_type,
      best_practices: page.best_practices,
    })),
    message: audit.message,
  };
}

type PageTaskArtifact = {
  audit_status?: "completed" | "in_progress";
  audit_result?: string;
  screenshot?: string;
  redo_screenshot?: string;
  eyeshot?: string;
  clarity?: string;
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
  const candidate = value as { eyeshot?: unknown; clarity?: unknown };
  return {
    ...(typeof candidate.eyeshot === "string" ? { eyeshot: candidate.eyeshot } : {}),
    ...(typeof candidate.clarity === "string" ? { clarity: candidate.clarity } : {}),
  };
}

async function getPageTaskArtifacts(
  runId: string,
  pageCount: number,
): Promise<Map<number, PageTaskArtifact>> {
  if (!runId.trim() || pageCount <= 0) {
    return new Map<number, PageTaskArtifact>();
  }
  const collection = getFirestoreClient().collection(AUDITS_COLLECTION);
  const indices = Array.from({ length: pageCount }, (_, i) => i);
  const [snapshots, redoSnapshots] = await Promise.all([
    Promise.all(indices.map((pageIndex) => collection.doc(`${runId}_page_${pageIndex}`).get())),
    Promise.all(indices.map((pageIndex) => collection.doc(`${runId}_page_${pageIndex}_redo`).get())),
  ]);
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
  redoSnapshots.forEach((snapshot, pageIndex) => {
    if (!snapshot.exists) {
      return;
    }
    const data = snapshot.data() as { screenshot?: unknown } | undefined;
    const redoScreenshot = typeof data?.screenshot === "string" && data.screenshot.trim()
      ? data.screenshot
      : undefined;
    if (redoScreenshot) {
      const existing = artifacts.get(pageIndex) ?? {};
      artifacts.set(pageIndex, { ...existing, redo_screenshot: redoScreenshot });
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

export async function getCompetitorArtifacts(
  runId: string,
  pageCount: number,
  competitorCount: number,
): Promise<CompetitorArtifact[][]> {
  if (!runId.trim() || pageCount <= 0 || competitorCount <= 0) {
    return [];
  }
  const collection = getFirestoreClient().collection(AUDITS_COLLECTION);
  const ids = Array.from({ length: pageCount }, (_, pi) =>
    Array.from({ length: competitorCount }, (__, ci) => taskIdForCompetitor(runId, pi, ci)),
  );
  const snapshots = await Promise.all(
    ids.map((row) => Promise.all(row.map((id) => collection.doc(id).get()))),
  );
  return snapshots.map((row) =>
    row.map((snapshot) => {
      if (!snapshot.exists) return { exists: false };
      const data = snapshot.data() as { screenshot?: unknown; result?: unknown } | undefined;
      const screenshot = typeof data?.screenshot === "string" ? data.screenshot : undefined;
      const result = typeof data?.result === "string" && data.result.trim() ? data.result.trim() : undefined;
      return { exists: true, ...(screenshot ? { screenshot } : {}), ...(result ? { result } : {}) };
    }),
  );
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
        ...(artifact.redo_screenshot ? { redo_screenshot: artifact.redo_screenshot } : {}),
        ...(artifact.eyeshot ? { eyeshot: artifact.eyeshot } : {}),
        ...(artifact.clarity ? { clarity: artifact.clarity } : {}),
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
    updatedAt?: unknown;
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
  const updatedAt =
    doc.updatedAt instanceof Timestamp ? doc.updatedAt.toDate() : createdAt;
  return {
    id,
    companyName,
    createdAtIso: createdAt.toISOString(),
    updatedAtIso: updatedAt.toISOString(),
  };
}

export type ListAuditRunsResult = {
  runs: AuditRunSummary[];
  hasMore: boolean;
  nextCursor: string | null;
};

export async function listAuditRuns(
  limit: number = DEFAULT_RUNS_LIMIT,
  startAfterIso?: string,
): Promise<ListAuditRunsResult> {
  let query = getFirestoreClient()
    .collection(RUNS_COLLECTION)
    .orderBy("updatedAt", "desc");

  if (startAfterIso) {
    query = query.startAfter(Timestamp.fromDate(new Date(startAfterIso)));
  }

  const snapshot = await query.limit(limit + 1).get();
  const all = snapshot.docs
    .map((doc) => toAuditRunSummary(doc.id, doc.data()))
    .filter((item): item is AuditRunSummary => item !== null);

  const hasMore = all.length > limit;
  const runs = hasMore ? all.slice(0, limit) : all;
  const nextCursor = hasMore ? (runs[runs.length - 1]?.updatedAtIso ?? null) : null;

  return { runs, hasMore, nextCursor };
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

function parseSlideReport(value: unknown): SlideReport | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const d = value as Record<string, unknown>;

  const findings = Array.isArray(d.findings)
    ? (d.findings as unknown[]).map((f): SlideFinding | null => {
        if (!f || typeof f !== "object") return null;
        const fi = f as Record<string, unknown>;
        if (typeof fi.problem_discovered !== "string" || typeof fi.description_of_problem !== "string") return null;
        return {
          category: typeof fi.category === "string" ? fi.category : undefined,
          problem_discovered: fi.problem_discovered,
          description_of_problem: fi.description_of_problem,
          status: typeof fi.status === "string" ? fi.status : undefined,
          reasoning: typeof fi.reasoning === "string" ? fi.reasoning : undefined,
          score: typeof fi.score === "number" ? fi.score : 0,
        };
      }).filter((f): f is SlideFinding => f !== null)
    : undefined;

  const recommendations = Array.isArray(d.recommendations)
    ? (d.recommendations as unknown[]).map((r): SlideRecommendation | null => {
        if (!r || typeof r !== "object") return null;
        const ri = r as Record<string, unknown>;
        return {
          recommendation: typeof ri.recommendation === "string" ? ri.recommendation : undefined,
          priority: typeof ri.priority === "string" ? ri.priority : undefined,
          action: typeof ri.action === "string" ? ri.action : undefined,
          impact: typeof ri.impact === "string" ? ri.impact : undefined,
        };
      }).filter((r): r is SlideRecommendation => r !== null)
    : undefined;

  let media_metrics: SlideMediaMetrics | undefined;
  if (d.media_metrics && typeof d.media_metrics === "object") {
    const m = d.media_metrics as Record<string, unknown>;
    media_metrics = {
      media_spend: typeof m.media_spend === "number" ? m.media_spend : undefined,
      media_traffic: typeof m.media_traffic === "number" ? m.media_traffic : undefined,
      media_transactions: typeof m.media_transactions === "number" ? m.media_transactions : undefined,
      revenue_per_sale: typeof m.revenue_per_sale === "number" ? m.revenue_per_sale : undefined,
      currency: typeof m.currency === "string" ? m.currency : undefined,
      current_cvr: typeof m.current_cvr === "number" ? m.current_cvr : undefined,
      cvr_lift: typeof m.cvr_lift === "number" ? m.cvr_lift : undefined,
      projected_cvr: typeof m.projected_cvr === "number" ? m.projected_cvr : undefined,
      revenue_opp: typeof m.revenue_opp === "number" ? m.revenue_opp : undefined,
      annual_cost: typeof m.annual_cost === "number" ? m.annual_cost : undefined,
      roi_percentage: typeof m.roi_percentage === "number" ? m.roi_percentage : undefined,
    };
  }

  return {
    final_score: typeof d.final_score === "number" ? d.final_score : undefined,
    url: typeof d.url === "string" ? d.url : undefined,
    vertical: typeof d.vertical === "string" ? d.vertical : undefined,
    clientName: typeof d.clientName === "string" ? d.clientName : undefined,
    status: typeof d.status === "string" ? d.status : undefined,
    executive_summary: typeof d.executive_summary === "string" ? d.executive_summary : undefined,
    media_metrics,
    findings,
    recommendations,
  };
}

export async function getPageReports(
  runId: string,
  pageCount: number,
): Promise<(SlideReport | null)[]> {
  if (!runId.trim() || pageCount <= 0) {
    return [];
  }
  const collection = getFirestoreClient().collection(REPORTS_COLLECTION);
  const snapshots = await Promise.all(
    Array.from({ length: pageCount }, (_, pageIndex) =>
      collection.doc(`${runId}_page_${pageIndex}`).get(),
    ),
  );
  return snapshots.map((snapshot) => {
    if (!snapshot.exists) return null;
    return parseSlideReport(snapshot.data());
  });
}

function parseGuestimateMetrics(data: unknown): SlideMediaMetrics | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const metrics: SlideMediaMetrics = {
    media_spend: typeof d.media_spend === "number" ? d.media_spend : undefined,
    media_traffic: typeof d.media_traffic === "number" ? d.media_traffic : undefined,
    media_transactions: typeof d.media_transactions === "number" ? d.media_transactions : undefined,
    revenue_per_sale: typeof d.revenue_per_sale === "number" ? d.revenue_per_sale : undefined,
    currency: typeof d.currency === "string" ? d.currency : undefined,
  };
  const hasAny = Object.values(metrics).some((v) => v != null);
  return hasAny ? metrics : null;
}

export async function getGuestimateReport(runId: string): Promise<SlideMediaMetrics | null> {
  if (!runId.trim()) return null;
  const snapshot = await getFirestoreClient().collection(REPORTS_COLLECTION).doc(runId).get();
  if (!snapshot.exists) return null;
  return parseGuestimateMetrics(snapshot.data());
}

export async function shotsDocumentExists(runId: string): Promise<boolean> {
  if (!runId.trim()) return false;
  const snapshot = await getFirestoreClient().collection(SHOTS_COLLECTION).doc(runId).get();
  return snapshot.exists;
}
