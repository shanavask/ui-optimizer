import { CloudTasksClient } from "@google-cloud/tasks";

let client: CloudTasksClient | null = null;

function getClient(): CloudTasksClient {
  if (!client) {
    client = new CloudTasksClient();
  }
  return client;
}

// No real Cloud Tasks queue is provisioned for local dev (`make dev` never
// sets PIPELINE_TASKS_QUEUE), so fall back to an in-process setTimeout that
// calls the tick logic directly. This is lost on process restart, which is
// fine for local dev only — every real deployment sets PIPELINE_TASKS_QUEUE.
function isDevMode(): boolean {
  return !process.env.PIPELINE_TASKS_QUEUE?.trim();
}

export async function enqueuePipelineTick(runId: string, delaySeconds: number): Promise<void> {
  if (isDevMode()) {
    setTimeout(() => {
      void import("@/lib/pipeline").then(({ runPipelineTick }) =>
        runPipelineTick(runId).catch((err) => {
          console.error("[pipeline-dev-tick] failed", { runId, err });
        }),
      );
    }, Math.max(0, delaySeconds) * 1000);
    return;
  }

  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim();
  const queue = process.env.PIPELINE_TASKS_QUEUE?.trim();
  const targetUrl = process.env.PIPELINE_TICK_URL?.trim();
  const serviceAccountEmail = process.env.PIPELINE_TASKS_SA_EMAIL?.trim();
  if (!project || !location || !queue || !targetUrl || !serviceAccountEmail) {
    throw new Error(
      "Missing one of GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION, PIPELINE_TASKS_QUEUE, PIPELINE_TICK_URL, PIPELINE_TASKS_SA_EMAIL.",
    );
  }

  // Cloud Run's ID-token audience check expects the service's origin only -
  // an audience that includes the request path (e.g. /api/pipeline/tick)
  // fails verification with UNAUTHENTICATED.
  const audience = new URL(targetUrl).origin;

  const parent = getClient().queuePath(project, location, queue);
  await getClient().createTask({
    parent,
    task: {
      httpRequest: {
        httpMethod: "POST",
        url: targetUrl,
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify({ runId })).toString("base64"),
        oidcToken: { serviceAccountEmail, audience },
      },
      ...(delaySeconds > 0
        ? { scheduleTime: { seconds: Math.floor(Date.now() / 1000) + delaySeconds } }
        : {}),
    },
  });
}
