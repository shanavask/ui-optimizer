export type PipelineStepId =
  | "criteria"
  | "audit"
  | "guestimate"
  | "competitors_run"
  | "competitors_audit"
  | "eyequant"
  | "report_generate"
  | "slides_create";

export const PIPELINE_STEP_ORDER: PipelineStepId[] = [
  "criteria",
  "audit",
  "guestimate",
  "competitors_run",
  "competitors_audit",
  "eyequant",
  "report_generate",
  "slides_create",
];

// A "blocking" step's trigger call only returns once the underlying work is
// done, so completion = trigger success. Non-blocking steps dispatch async
// work (BrowserUse) or lag their Firestore write (EyeQuant), so the tick
// route must poll a completion predicate after triggering.
export const STEP_IS_BLOCKING: Record<PipelineStepId, boolean> = {
  criteria: true,
  audit: false,
  guestimate: true,
  competitors_run: false,
  competitors_audit: true,
  eyequant: false,
  report_generate: true,
  slides_create: true,
};

export const STEP_POLL_DELAY_SECONDS: Record<PipelineStepId, number> = {
  criteria: 0,
  audit: 15,
  guestimate: 0,
  competitors_run: 15,
  competitors_audit: 0,
  eyequant: 15,
  report_generate: 0,
  slides_create: 0,
};

// Soft staleness guard: if a non-blocking step is still "running" after this
// long, the pipeline fails instead of polling forever against a stuck job.
export const STEP_TIMEOUT_MS: Record<PipelineStepId, number> = {
  criteria: 10 * 60_000,
  audit: 30 * 60_000,
  guestimate: 10 * 60_000,
  competitors_run: 30 * 60_000,
  competitors_audit: 10 * 60_000,
  eyequant: 10 * 60_000,
  report_generate: 10 * 60_000,
  slides_create: 10 * 60_000,
};

// Per-step AbortController timeout for the trigger call itself, mirroring
// the timeouts the equivalent manual routes already use (e.g. /api/analyze's
// 600s, /api/roi/guestimate's 300s). The Cloud Tasks queue's own dispatch
// deadline must be configured at least this long for the longest step
// (competitors_audit/criteria, 600s) plus headroom.
export const STEP_TRIGGER_TIMEOUT_MS: Record<PipelineStepId, number> = {
  criteria: 600_000,
  audit: 60_000,
  guestimate: 300_000,
  competitors_run: 60_000,
  competitors_audit: 600_000,
  eyequant: 300_000,
  report_generate: 300_000,
  slides_create: 300_000,
};

// Collapses the 8 internal steps to the 6 user-facing labels for display.
export const DISPLAY_STEP_LABEL: Record<PipelineStepId, string> = {
  criteria: "Criteria",
  audit: "Audit",
  guestimate: "Guestimate",
  competitors_run: "Competitors",
  competitors_audit: "Competitors",
  eyequant: "EyeQuant",
  report_generate: "Slides",
  slides_create: "Slides",
};

export type PipelineStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export type PipelineStepRecord = {
  status: PipelineStepStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

export type PipelineStatus = "running" | "completed" | "failed";

export type PipelineDoc = {
  runId: string;
  currentStepIndex: number;
  status: PipelineStatus;
  steps: Record<PipelineStepId, PipelineStepRecord>;
  error?: string;
  createdAtIso: string;
  updatedAtIso: string;
};
