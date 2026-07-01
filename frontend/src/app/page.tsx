"use client";

import { useCallback, useEffect, useState } from "react";

import { AuditResultEditor } from "@/app/components/AuditResultEditor";
import { AuditTabs } from "@/app/components/AuditTabs";
import { taskIdForPage } from "@/lib/task-ids";
import type { CompetitorArtifact, SlideReport, UIAuditResponse } from "@/types/audit";

type AnalyzeResponse = { audit: UIAuditResponse; runId?: string };
type ErrorBody = { error: string; rejectedUrls?: string[] };
type SaveRunResponse = { runId: string; audit: UIAuditResponse };
type CreateSlidesResponse = { slidesUrl: string };
type SlidesUrlResponse = { slidesUrl: string | null };
type SlideReportsResponse = { reports: (SlideReport | null)[] };
type EyeQuantResponse = { status: string };
type RunCompetitorsResponse = { dispatched: string[]; skipped: string[]; errors: string[] };
type RoiResponse = { exists: boolean; content: string | null };
type GuestimateRoiResponse = { content: string };
type OkResponse = { ok: boolean };
type RunSummary = {
  id: string;
  companyName: string;
  createdAtIso: string;
};
type RunsResponse = { runs: RunSummary[] };
const UI_AGENT_USERNAME = "ui-audit-user";

async function getRunAudit(runId: string): Promise<UIAuditResponse> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);
  const data: unknown = await response.json();
  if (!response.ok) {
    const err = data as ErrorBody;
    const detail =
      typeof err.error === "string" ? err.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  const ok = data as AnalyzeResponse;
  return ok.audit;
}

async function postAnalyze(
  urlsText: string,
  saveRun: boolean = false,
  username?: string,
  runId?: string,
): Promise<AnalyzeResponse> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      urlsText,
      saveRun,
      ...(username ? { username } : {}),
      ...(runId ? { runId } : {}),
    }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const err = data as ErrorBody;
    const detail =
      typeof err.error === "string" ? err.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  const ok = data as AnalyzeResponse;
  return ok;
}

async function postSaveRun(audit: UIAuditResponse, runId?: string): Promise<SaveRunResponse> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audit, ...(runId ? { runId } : {}) }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const err = data as ErrorBody;
    const detail =
      typeof err.error === "string" ? err.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return data as SaveRunResponse;
}

async function postCreateSlides(
  taskIds: string[],
  runId: string,
): Promise<CreateSlidesResponse> {
  const response = await fetch("/api/slides/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskIds, runId }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const err = data as ErrorBody;
    const detail =
      typeof err.error === "string" ? err.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return data as CreateSlidesResponse;
}

async function postEyeQuant(runId: string, pageIndex?: number): Promise<EyeQuantResponse> {
  console.info("[ui] posting EyeQuant request", { runId, pageIndex });
  const response = await fetch("/api/slides/eyequant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pageIndex !== undefined ? { runId, pageIndex } : { runId }),
  });
  const data: unknown = await response.json();
  console.info("[ui] EyeQuant response received", {
    runId,
    status: response.status,
    ok: response.ok,
    payload: data,
  });
  if (!response.ok) {
    const err = data as ErrorBody;
    const detail =
      typeof err.error === "string" ? err.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return data as EyeQuantResponse;
}

function guestimateFallback(audit: UIAuditResponse): string {
  const urls = audit.pages.map((page) => page.url).join(", ");
  return `Company: ${audit.company_name}\nVertical: ${audit.vertical}\nUrls: ${urls}`;
}

async function getRoiDocument(runId: string): Promise<RoiResponse> {
  const response = await fetch(`/api/roi/${encodeURIComponent(runId)}`);
  const data: unknown = await response.json();
  if (!response.ok) {
    const err = data as ErrorBody;
    const detail =
      typeof err.error === "string" ? err.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  const ok = data as RoiResponse;
  return {
    exists: ok.exists === true,
    content: typeof ok.content === "string" ? ok.content : null,
  };
}

async function postGuestimateRoi(
  runId: string,
  urlsText: string,
  guestimateText: string,
  username?: string,
): Promise<GuestimateRoiResponse> {
  const response = await fetch("/api/roi/guestimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runId, urlsText, guestimateText, ...(username ? { username } : {}) }),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const err = data as ErrorBody;
    const detail =
      typeof err.error === "string" ? err.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return data as GuestimateRoiResponse;
}

async function getSlidesUrl(runId: string): Promise<string | null> {
  const response = await fetch(`/api/slides/create?runId=${encodeURIComponent(runId)}`);
  const data: unknown = await response.json();
  if (!response.ok) {
    return null;
  }
  const ok = data as SlidesUrlResponse;
  return ok.slidesUrl ?? null;
}

async function getSlideReports(runId: string): Promise<(SlideReport | null)[]> {
  const response = await fetch(`/api/slides/reports?runId=${encodeURIComponent(runId)}`);
  const data: unknown = await response.json();
  if (!response.ok) {
    return [];
  }
  const ok = data as SlideReportsResponse;
  return Array.isArray(ok.reports) ? ok.reports : [];
}

async function getCompetitorArtifacts(runId: string): Promise<CompetitorArtifact[][]> {
  const response = await fetch(`/api/competitors/artifacts?runId=${encodeURIComponent(runId)}`);
  const data: unknown = await response.json();
  if (!response.ok) return [];
  const ok = data as { artifacts?: CompetitorArtifact[][] };
  return Array.isArray(ok.artifacts) ? ok.artifacts : [];
}

async function deleteRun(runId: string): Promise<void> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
    method: "DELETE",
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const err = data as ErrorBody;
    const detail =
      typeof err.error === "string" ? err.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  const ok = data as OkResponse;
  if (!ok.ok) {
    throw new Error("Delete run response was not successful.");
  }
}

function formatRunDate(dateIso: string): string {
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function HomePage(): React.JSX.Element {
  const [urlsText, setUrlsText] = useState("");
  const [audit, setAudit] = useState<UIAuditResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [runDetailLoadingId, setRunDetailLoadingId] = useState<string | null>(null);
  const [creatingSlides, setCreatingSlides] = useState(false);
  const [runningEyeQuant, setRunningEyeQuant] = useState(false);
  const [redoingEyeQuantPage, setRedoingEyeQuantPage] = useState<number | null>(null);
  const [runningCompetitors, setRunningCompetitors] = useState(false);
  const [guestimatingRoi, setGuestimatingRoi] = useState(false);
  const [slidesUrl, setSlidesUrl] = useState<string | null>(null);
  const [slideReports, setSlideReports] = useState<(SlideReport | null)[]>([]);
  const [competitorArtifacts, setCompetitorArtifacts] = useState<CompetitorArtifact[][]>([]);
  const [guestimateContent, setGuestimateContent] = useState<string>("");
  const [hasRoiDocument, setHasRoiDocument] = useState<boolean>(false);

  const fetchRuns = useCallback(async (): Promise<RunSummary[]> => {
    const response = await fetch("/api/runs");
    const data: unknown = await response.json();
    if (!response.ok) {
      const err = data as ErrorBody;
      const detail =
        typeof err.error === "string" ? err.error : `HTTP ${response.status}`;
      throw new Error(detail);
    }
    const ok = data as RunsResponse;
    return ok.runs;
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadInitialRuns = async () => {
      try {
        const nextRuns = await fetchRuns();
        if (!isMounted) {
          return;
        }
        setRuns(nextRuns);
      } catch (err) {
        if (!isMounted) {
          return;
        }
        setRunsError(err instanceof Error ? err.message : "Failed to load runs");
      } finally {
        if (isMounted) {
          setRunsLoading(false);
        }
      }
    };
    void loadInitialRuns();
    return () => {
      isMounted = false;
    };
  }, [fetchRuns]);

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    setRunsError(null);
    try {
      const nextRuns = await fetchRuns();
      setRuns(nextRuns);
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : "Failed to load runs");
    } finally {
      setRunsLoading(false);
    }
  }, [fetchRuns]);

  const runAudit = useCallback(
    async (
      inputUrls: string,
      clearAuditOnError: boolean,
      saveRun: boolean,
      runId?: string,
    ) => {
      setError(null);
      setLoading(true);
      try {
        const result = await postAnalyze(inputUrls, saveRun, UI_AGENT_USERNAME, runId);
        setAudit(result.audit);
        setSlidesUrl(null);
        if (saveRun && result.runId) {
          setSelectedRunId(result.runId);
        }
        if (!saveRun) {
          setSelectedRunId(null);
        }
      } catch (err) {
        if (clearAuditOnError) {
          setAudit(null);
        }
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      await runAudit(urlsText, true, false);
    },
    [runAudit, urlsText],
  );

  const onRunAuditFromData = useCallback(async () => {
    if (!audit) {
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await postSaveRun(audit, selectedRunId ?? undefined);
      setAudit(result.audit);
      setSelectedRunId(result.runId);
      setSlidesUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [audit, selectedRunId]);

  const onSelectRun = useCallback(async (runId: string) => {
    setError(null);
    setRunDetailLoadingId(runId);
    try {
      const [nextAudit, existingSlidesUrl, reports, compArtifacts] = await Promise.all([
        getRunAudit(runId),
        getSlidesUrl(runId),
        getSlideReports(runId),
        getCompetitorArtifacts(runId),
      ]);
      setAudit(nextAudit);
      setSelectedRunId(runId);
      setSlidesUrl(existingSlidesUrl);
      setSlideReports(reports);
      setCompetitorArtifacts(compArtifacts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run");
    } finally {
      setRunDetailLoadingId(null);
    }
  }, []);

  const onDeleteRun = useCallback(
    async (runId: string) => {
      setError(null);
      setRunsError(null);
      setDeletingRunId(runId);
      try {
        await deleteRun(runId);
        setRuns((currentRuns) => currentRuns.filter((run) => run.id !== runId));
        if (selectedRunId === runId) {
          setSelectedRunId(null);
          setAudit(null);
          setSlidesUrl(null);
          setSlideReports([]);
          setCompetitorArtifacts([]);
          setGuestimateContent("");
          setHasRoiDocument(false);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete run";
        setRunsError(message);
      } finally {
        setDeletingRunId(null);
      }
    },
    [selectedRunId],
  );

  const onCreateSlides = useCallback(async () => {
    if (!audit || !selectedRunId) {
      return;
    }
    setError(null);
    setCreatingSlides(true);
    try {
      const taskIds = audit.pages.map((_, pageIndex) =>
        taskIdForPage(selectedRunId, pageIndex),
      );
      const result = await postCreateSlides(taskIds, selectedRunId);
      setSlidesUrl(result.slidesUrl);
      const reports = await getSlideReports(selectedRunId);
      setSlideReports(reports);
    } catch (err) {
      setSlidesUrl(null);
      setError(err instanceof Error ? err.message : "Failed to create slides");
    } finally {
      setCreatingSlides(false);
    }
  }, [audit, selectedRunId]);

  const onRunEyeQuant = useCallback(async () => {
    if (!audit || !selectedRunId) {
      return;
    }
    setError(null);
    setRunningEyeQuant(true);
    try {
      const result = await postEyeQuant(selectedRunId);
      console.info("[ui] EyeQuant status parsed", {
        runId: selectedRunId,
        status: result.status,
      });
      if (result.status.trim().toLowerCase() === "success") {
        const maxAttempts = 5;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          console.info("[ui] reloading run for eyeshot refresh", {
            runId: selectedRunId,
            attempt: attempt + 1,
            maxAttempts,
          });
          const refreshedAudit = await getRunAudit(selectedRunId);
          setAudit(refreshedAudit);
          const missingEyeshot = refreshedAudit.pages.some(
            (page) => !page.eyeshot || !page.eyeshot.trim(),
          );
          console.info("[ui] eyeshot refresh result", {
            runId: selectedRunId,
            attempt: attempt + 1,
            missingEyeshot,
          });
          if (!missingEyeshot) {
            break;
          }
          if (attempt < maxAttempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
        }
      } else {
        throw new Error(`EyeQuant API returned "${result.status}"`);
      }
    } catch (err) {
      console.error("[ui] EyeQuant flow failed", {
        runId: selectedRunId,
        error: err,
      });
      setError(err instanceof Error ? err.message : "Failed to run EyeQuant");
    } finally {
      setRunningEyeQuant(false);
    }
  }, [audit, selectedRunId]);

  const onRedoEyeQuantPage = useCallback(async (pageIndex: number) => {
    if (!audit || !selectedRunId) return;
    setError(null);
    setRedoingEyeQuantPage(pageIndex);
    try {
      const response = await fetch("/api/redo-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: selectedRunId, pageIndex }),
      });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to redo screenshot");
    } finally {
      setRedoingEyeQuantPage(null);
    }
  }, [audit, selectedRunId]);

  const onRunCompetitors = useCallback(async () => {
    if (!selectedRunId) return;
    setError(null);
    setRunningCompetitors(true);
    try {
      const response = await fetch("/api/competitors/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: selectedRunId }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const err = data as { error?: string };
        throw new Error(typeof err.error === "string" ? err.error : `HTTP ${response.status}`);
      }
      const result = data as RunCompetitorsResponse;
      if (result.errors.length > 0) {
        setError(`Some tasks failed: ${result.errors.join(", ")}`);
      }
      const refreshed = await getCompetitorArtifacts(selectedRunId);
      setCompetitorArtifacts(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run competitors");
    } finally {
      setRunningCompetitors(false);
    }
  }, [selectedRunId]);

  const onGuestimateRoi = useCallback(async () => {
    if (!audit || !selectedRunId) {
      return;
    }
    setError(null);
    setGuestimatingRoi(true);
    try {
      const urlsText = audit.pages.map((page) => page.url).join("\n");
      const result = await postGuestimateRoi(
        selectedRunId,
        urlsText,
        guestimateContent,
        UI_AGENT_USERNAME,
      );
      setGuestimateContent(result.content);
      setHasRoiDocument(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to guestimate ROI");
    } finally {
      setGuestimatingRoi(false);
    }
  }, [audit, guestimateContent, selectedRunId]);

  const onSaveGuestimate = useCallback(async (content: string) => {
    if (!selectedRunId) return;
    const response = await fetch(`/api/roi/${encodeURIComponent(selectedRunId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      throw new Error("Failed to save ROI document");
    }
    setGuestimateContent(content);
    setHasRoiDocument(true);
  }, [selectedRunId]);

  useEffect(() => {
    let isMounted = true;
    const loadGuestimate = async () => {
      if (!audit || !selectedRunId) {
        setGuestimateContent("");
        setHasRoiDocument(false);
        return;
      }
      const fallback = guestimateFallback(audit);
      setGuestimateContent(fallback);
      try {
        const roiDocument = await getRoiDocument(selectedRunId);
        if (!isMounted) {
          return;
        }
        setHasRoiDocument(roiDocument.exists);
        setGuestimateContent(
          roiDocument.content && roiDocument.content.trim() ? roiDocument.content : fallback,
        );
      } catch {
        if (isMounted) {
          setHasRoiDocument(false);
          setGuestimateContent(fallback);
        }
      }
    };
    void loadGuestimate();
    return () => {
      isMounted = false;
    };
  }, [audit, selectedRunId]);

  return (
    <main className="page">
      <aside className="runs-sidebar">
        <div className="runs-sidebar-header">
          <h2 className="runs-sidebar-title">Recent runs</h2>
          <button
            type="button"
            className="runs-refresh-button"
            onClick={() => void loadRuns()}
            disabled={runsLoading}
          >
            {runsLoading ? "Loading..." : "Refresh"}
          </button>
        </div>
        {runsError ? (
          <p className="runs-sidebar-error" role="alert">
            {runsError}
          </p>
        ) : null}
        {!runsError && runs.length === 0 && !runsLoading ? (
          <p className="runs-empty">No runs found.</p>
        ) : null}
        <ul className="runs-list">
          {runs.map((run) => (
            <li key={run.id} className="runs-list-item">
              <div className="runs-list-row">
                <button
                  type="button"
                  className={`runs-list-button ${
                    selectedRunId === run.id ? "runs-list-button-active" : ""
                  }`}
                  onClick={() => void onSelectRun(run.id)}
                  disabled={runDetailLoadingId === run.id || deletingRunId === run.id}
                >
                  <p className="runs-company">{run.companyName}</p>
                  <p className="runs-date">{formatRunDate(run.createdAtIso)}</p>
                  {runDetailLoadingId === run.id ? (
                    <p className="runs-loading-indicator">Opening...</p>
                  ) : null}
                </button>
                <button
                  type="button"
                  className="runs-delete-icon-button"
                  onClick={() => void onDeleteRun(run.id)}
                  disabled={deletingRunId === run.id || runDetailLoadingId === run.id}
                  aria-label={`Delete ${run.companyName} run`}
                  title="Delete run"
                >
                  <svg
                    className="runs-delete-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>
      <section className={`card ${audit ? "card-wide card-audit-view" : ""}`}>
        {!audit ? (
          <>
            <p className="card-lead">
              Enter one URL per line. You can paste multiple pages to audit at
              once.
            </p>
            <form className="url-form" method="post" onSubmit={onSubmit}>
              <label htmlFor="url-input">URLs</label>
              <textarea
                id="url-input"
                rows={8}
                value={urlsText}
                onChange={(ev) => setUrlsText(ev.target.value)}
                placeholder={
                  "https://example.com\nhttps://example.com/about\nhttps://example.com/pricing"
                }
                spellCheck={false}
                required
                disabled={loading}
              />
              <button type="submit" disabled={loading}>
                {loading ? "Analyzing…" : "Analyze"}
              </button>
            </form>
          </>
        ) : selectedRunId ? (
          <AuditTabs
            audit={audit}
            onChange={setAudit}
            agentUsername={UI_AGENT_USERNAME}
            loading={loading}
            onRunAudit={onRunAuditFromData}
            guestimateContent={guestimateContent}
            hasRoiDocument={hasRoiDocument}
            onGuestimateRoi={onGuestimateRoi}
            guestimatingRoi={guestimatingRoi}
            onSaveGuestimate={onSaveGuestimate}
            onRunEyeQuant={onRunEyeQuant}
            runningEyeQuant={runningEyeQuant}
            onRedoEyeQuantPage={onRedoEyeQuantPage}
            redoingEyeQuantPage={redoingEyeQuantPage}
            slidesUrl={slidesUrl}
            onCreateSlides={onCreateSlides}
            creatingSlides={creatingSlides}
            slideReports={slideReports}
            onRunCompetitors={onRunCompetitors}
            runningCompetitors={runningCompetitors}
            competitorArtifacts={competitorArtifacts}
          />
        ) : (
          <AuditResultEditor
            value={audit}
            onChange={setAudit}
            agentUsername={UI_AGENT_USERNAME}
            hideAuditData={false}
            loading={loading}
            onRunAudit={onRunAuditFromData}
          />
        )}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
