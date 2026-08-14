import { DEFAULT_AGENT_USERNAME } from "@/lib/agent-run";
import { dispatchBrowserUseTasks, dispatchCompetitorTasks } from "@/lib/browseruse";
import { enqueuePipelineTick } from "@/lib/cloud-tasks";
import {
  advancePipelineToStep,
  beginPipelineStep,
  getAuditRun,
  getCompetitorArtifacts,
  getPipelineDoc,
  markPipelineCompleted,
  markPipelineFailed,
  markPipelineStepCompleted,
  markPipelineStepsSkipped,
} from "@/lib/firestore-runs";
import {
  runCompetitorsAuditStep,
  runCriteriaStep,
  runEyeQuantStep,
  runGuestimateStep,
  runReportGenerateStep,
  runSlidesCreateStep,
} from "@/lib/pipeline-actions";
import {
  PIPELINE_STEP_ORDER,
  STEP_IS_BLOCKING,
  STEP_POLL_DELAY_SECONDS,
  STEP_TIMEOUT_MS,
  STEP_TRIGGER_TIMEOUT_MS,
  type PipelineStepId,
} from "@/lib/pipeline-steps";
import { taskIdForPage } from "@/lib/task-ids";
import type { UIAuditResponse } from "@/types/audit";

type StepRunContext = {
  runId: string;
  audit: UIAuditResponse;
  username: string;
};

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return typeof err === "string" && err.trim() ? err : "Unexpected pipeline step failure.";
}

function withTriggerTimeout<T>(
  step: PipelineStepId,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STEP_TRIGGER_TIMEOUT_MS[step]);
  return run(controller.signal).finally(() => clearTimeout(timeout));
}

async function triggerStep(step: PipelineStepId, ctx: StepRunContext): Promise<void> {
  const urls = ctx.audit.pages.map((p) => p.url);
  switch (step) {
    case "criteria":
      await withTriggerTimeout(step, (signal) => runCriteriaStep(ctx.runId, urls, signal, ctx.username));
      return;
    case "audit":
      await withTriggerTimeout(step, (signal) => dispatchBrowserUseTasks(ctx.audit, signal, ctx.runId));
      return;
    case "guestimate":
      await withTriggerTimeout(step, (signal) => runGuestimateStep(ctx.runId, urls, signal, "", ctx.username));
      return;
    case "competitors_run":
      await withTriggerTimeout(step, (signal) => dispatchCompetitorTasks(ctx.audit, ctx.runId, signal));
      return;
    case "competitors_audit":
      await withTriggerTimeout(step, (signal) =>
        runCompetitorsAuditStep(ctx.runId, ctx.audit, signal, ctx.username),
      );
      return;
    case "eyequant":
      await runEyeQuantStep(ctx.runId, null);
      return;
    case "report_generate":
      await withTriggerTimeout(step, (signal) => runReportGenerateStep(ctx.runId, signal, ctx.username));
      return;
    case "slides_create": {
      const taskIds = ctx.audit.pages.map((_, pageIndex) => taskIdForPage(ctx.runId, pageIndex));
      await runSlidesCreateStep(ctx.runId, taskIds);
      return;
    }
  }
}

async function checkStepComplete(step: PipelineStepId, ctx: StepRunContext): Promise<boolean> {
  switch (step) {
    case "audit":
      return ctx.audit.pages.length > 0 && ctx.audit.pages.every((p) => p.audit_status === "completed");
    case "competitors_run": {
      const competitors = ctx.audit.competitors ?? [];
      if (competitors.length === 0 || ctx.audit.pages.length === 0) {
        return true;
      }
      const artifacts = await getCompetitorArtifacts(ctx.runId, ctx.audit.pages.length, competitors.length);
      return ctx.audit.pages.every((_, pageIndex) =>
        competitors.every((c, competitorIndex) => {
          if (!c.competitor_url?.trim()) return true;
          return artifacts[pageIndex]?.[competitorIndex]?.exists === true;
        }),
      );
    }
    case "eyequant":
      return !ctx.audit.pages.some((p) => !p.eyeshot?.trim());
    default:
      // Blocking steps: trigger success already implies completion, this
      // branch is never reached for them by the state machine below.
      return true;
  }
}

async function completeStepAndAdvance(runId: string, currentIndex: number): Promise<void> {
  const step = PIPELINE_STEP_ORDER[currentIndex];
  await markPipelineStepCompleted(runId, step);
  const nextIndex = currentIndex + 1;
  if (nextIndex >= PIPELINE_STEP_ORDER.length) {
    await markPipelineCompleted(runId);
    return;
  }
  await advancePipelineToStep(runId, nextIndex);
  await enqueuePipelineTick(runId, 0);
}

// The single-tick-does-one-thing design (trigger-then-return, or
// check-then-return, never both in one invocation) means a Cloud Tasks
// redelivery of the same tick can't double-trigger: it always re-reads the
// doc fresh, and the pending->running flip is transaction-guarded.
export async function runPipelineTick(runId: string): Promise<void> {
  const doc = await getPipelineDoc(runId);
  if (!doc || doc.status !== "running") {
    return;
  }
  const step = PIPELINE_STEP_ORDER[doc.currentStepIndex];
  if (!step) {
    await markPipelineCompleted(runId);
    return;
  }

  const audit = await getAuditRun(runId);
  if (!audit) {
    await markPipelineFailed(runId, step, `Run ${runId} not found.`);
    return;
  }
  const ctx: StepRunContext = { runId, audit, username: DEFAULT_AGENT_USERNAME };
  const hasCompetitors = (audit.competitors?.length ?? 0) > 0;

  if (step === "competitors_run" && !hasCompetitors) {
    await markPipelineStepsSkipped(runId, ["competitors_run", "competitors_audit"]);
    const nextIndex = PIPELINE_STEP_ORDER.indexOf("eyequant");
    await advancePipelineToStep(runId, nextIndex);
    await enqueuePipelineTick(runId, 0);
    return;
  }
  if (step === "competitors_audit" && !hasCompetitors) {
    await markPipelineStepsSkipped(runId, ["competitors_audit"]);
    await advancePipelineToStep(runId, doc.currentStepIndex + 1);
    await enqueuePipelineTick(runId, 0);
    return;
  }

  const record = doc.steps[step];

  if (record.status === "pending") {
    const claimed = await beginPipelineStep(runId, step);
    if (!claimed) {
      // Another tick already claimed this step (concurrent/redelivered
      // invocation) - back off briefly and let it run.
      await enqueuePipelineTick(runId, 5);
      return;
    }
    try {
      await triggerStep(step, ctx);
    } catch (err) {
      await markPipelineFailed(runId, step, toErrorMessage(err));
      return;
    }
    if (STEP_IS_BLOCKING[step]) {
      await completeStepAndAdvance(runId, doc.currentStepIndex);
    } else {
      await enqueuePipelineTick(runId, STEP_POLL_DELAY_SECONDS[step] || 15);
    }
    return;
  }

  if (record.status === "running") {
    const startedAtMs = record.startedAt ? new Date(record.startedAt).getTime() : Date.now();
    if (Date.now() - startedAtMs > STEP_TIMEOUT_MS[step]) {
      await markPipelineFailed(
        runId,
        step,
        `Step "${step}" timed out after ${Math.round(STEP_TIMEOUT_MS[step] / 60_000)} minutes.`,
      );
      return;
    }
    const complete = await checkStepComplete(step, ctx);
    if (!complete) {
      await enqueuePipelineTick(runId, STEP_POLL_DELAY_SECONDS[step] || 15);
      return;
    }
    await completeStepAndAdvance(runId, doc.currentStepIndex);
    return;
  }

  // status is "completed" | "failed" | "skipped": stale/redelivered tick for
  // a step that has already resolved - no-op.
}
