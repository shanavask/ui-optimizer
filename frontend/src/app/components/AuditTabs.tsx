"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { textToBestPractices } from "@/lib/best-practices-text";
import type { CompetitorArtifact, PageAudit, SlideReport, UIAuditResponse } from "@/types/audit";

import { AuditPageCard } from "./AuditPageCard";

type Tab = "audit-data" | "audit-report" | "competitors" | "guestimate" | "eyequant" | "slides";

type AuditTabsProps = Readonly<{
  audit: UIAuditResponse;
  onChange: (next: UIAuditResponse) => void;
  agentUsername?: string;
  loading?: boolean;
  onRunAudit?: () => Promise<void>;
  guestimateContent: string;
  hasRoiDocument: boolean;
  onGuestimateRoi?: () => Promise<void>;
  guestimatingRoi?: boolean;
  onSaveGuestimate?: (content: string) => Promise<void>;
  onRunEyeQuant?: () => Promise<void>;
  runningEyeQuant?: boolean;
  onRedoEyeQuantPage?: (pageIndex: number) => Promise<void>;
  redoingEyeQuantPage?: number | null;
  slidesUrl?: string | null;
  onCreateSlides?: () => Promise<void>;
  creatingSlides?: boolean;
  slideReports?: (SlideReport | null)[];
  onRunCompetitors?: () => Promise<void>;
  runningCompetitors?: boolean;
  competitorArtifacts?: CompetitorArtifact[][];
}>;;

function replacePage(pages: PageAudit[], index: number, page: PageAudit): PageAudit[] {
  const next = [...pages];
  next[index] = page;
  return next;
}

export function AuditTabs({
  audit,
  onChange,
  agentUsername,
  loading = false,
  onRunAudit,
  guestimateContent,
  hasRoiDocument,
  onGuestimateRoi,
  guestimatingRoi = false,
  onSaveGuestimate,
  onRunEyeQuant,
  runningEyeQuant = false,
  onRedoEyeQuantPage,
  redoingEyeQuantPage = null,
  slidesUrl = null,
  onCreateSlides,
  creatingSlides = false,
  slideReports,
  onRunCompetitors,
  runningCompetitors = false,
  competitorArtifacts = [],
}: AuditTabsProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<Tab>("audit-data");
  const [expandedReports, setExpandedReports] = useState<Set<number>>(new Set());
  const [redoSubmittedPages, setRedoSubmittedPages] = useState<Set<number>>(new Set());
  const [editedGuestimate, setEditedGuestimate] = useState<string>(guestimateContent);
  const [guestimateDirty, setGuestimateDirty] = useState<boolean>(false);
  const [savingGuestimate, setSavingGuestimate] = useState<boolean>(false);

  useEffect(() => {
    setEditedGuestimate(guestimateContent);
    setGuestimateDirty(false);
  }, [guestimateContent]);

  const handleGuestimateChange = useCallback((value: string) => {
    setEditedGuestimate(value);
    setGuestimateDirty(true);
  }, []);

  const handleSaveGuestimate = useCallback(async () => {
    if (!onSaveGuestimate) return;
    setSavingGuestimate(true);
    try {
      await onSaveGuestimate(editedGuestimate);
      setGuestimateDirty(false);
    } finally {
      setSavingGuestimate(false);
    }
  }, [onSaveGuestimate, editedGuestimate]);

  const handleRedoPage = useCallback(async (pageIndex: number) => {
    if (!onRedoEyeQuantPage) return;
    await onRedoEyeQuantPage(pageIndex);
    setRedoSubmittedPages((prev) => new Set(prev).add(pageIndex));
    setTimeout(() => {
      setRedoSubmittedPages((prev) => {
        const next = new Set(prev);
        next.delete(pageIndex);
        return next;
      });
    }, 5000);
  }, [onRedoEyeQuantPage]);

  const toggleReport = useCallback((index: number) => {
    setExpandedReports((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const setCompanyName = useCallback(
    (company_name: string) => onChange({ ...audit, company_name }),
    [onChange, audit],
  );

  const setVertical = useCallback(
    (vertical: string) => onChange({ ...audit, vertical }),
    [onChange, audit],
  );

  const onUrlChange = useCallback(
    (index: number, url: string) => {
      const page = audit.pages[index];
      if (!page) return;
      onChange({ ...audit, pages: replacePage(audit.pages, index, { ...page, url }) });
    },
    [onChange, audit],
  );

  const onPageTypeChange = useCallback(
    (index: number, page_type: string) => {
      const page = audit.pages[index];
      if (!page) return;
      onChange({ ...audit, pages: replacePage(audit.pages, index, { ...page, page_type }) });
    },
    [onChange, audit],
  );

  const onCompetitorChange = useCallback(
    (index: number, field: "competitor_name" | "competitor_url", value: string) => {
      const competitors = [...(audit.competitors ?? [])];
      const entry = competitors[index];
      if (!entry) return;
      competitors[index] = { ...entry, [field]: value };
      onChange({ ...audit, competitors });
    },
    [onChange, audit],
  );

  const onBestPracticesTextChange = useCallback(
    (pageIndex: number, text: string) => {
      const page = audit.pages[pageIndex];
      if (!page) return;
      const best_practices = textToBestPractices(text);
      onChange({ ...audit, pages: replacePage(audit.pages, pageIndex, { ...page, best_practices }) });
    },
    [onChange, audit],
  );

  const onRememberPageBestPractices = useCallback(
    async (vertical: string, pageType: string, bestPractices: string) => {
      const response = await fetch("/api/remember", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vertical, pageType, bestPractices, username: agentUsername }),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const errorValue = (data as { error?: unknown }).error;
        const detail =
          typeof errorValue === "string" && errorValue.trim().length > 0
            ? errorValue
            : `HTTP ${response.status}`;
        throw new Error(detail);
      }
    },
    [agentUsername],
  );

  const allCompetitorsComplete =
    audit.competitors && audit.competitors.length > 0 && audit.pages.length > 0 &&
    audit.pages.every((_, pageIndex) =>
      (audit.competitors ?? []).every((c, competitorIndex) => {
        if (!c.competitor_url?.trim()) return true;
        return competitorArtifacts[pageIndex]?.[competitorIndex]?.exists === true;
      }),
    );

  const canCreateSlides =
    audit.pages.length > 0 && audit.pages.every((p) => p.audit_status === "completed");

  const hasAuditReport =
    audit.pages.length > 0 &&
    audit.pages.every((p) => p.audit_status === "completed" && !!p.audit_result?.trim());

  const auditInProgress = audit.pages.some((p) => p.audit_status === "in_progress");

  const missingEyeshot = audit.pages.some((p) => !p.eyeshot?.trim());

  const tabs: { id: Tab; label: string }[] = [
    { id: "audit-data", label: "Audit Data" },
    { id: "audit-report", label: "Audit Report" },
    { id: "competitors", label: "Competitors" },
    { id: "guestimate", label: "Guestimate" },
    { id: "eyequant", label: "EyeQuant" },
    { id: "slides", label: "Slides" },
  ];

  return (
    <div className="audit-tabs">
      <nav className="audit-tabs-nav" aria-label="Audit sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`audit-tab-button ${activeTab === tab.id ? "audit-tab-button-active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
            aria-selected={activeTab === tab.id}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="audit-tab-content">
        {activeTab === "audit-data" && (
          <div className="audit-tab-panel">
            <div className="audit-result-header">
              <h2 className="audit-result-title">
                {audit.company_name ? audit.company_name : "Audit Data"}
              </h2>
              {onRunAudit && !hasAuditReport && !auditInProgress && (
                <button
                  type="button"
                  className="audit-run-button"
                  onClick={() => void onRunAudit()}
                  disabled={loading}
                >
                  {loading ? "Running..." : "Run Audit"}
                </button>
              )}
            </div>
            <div className="audit-meta-row">
              <label className="audit-field">
                <span>Company name</span>
                <input
                  type="text"
                  value={audit.company_name}
                  onChange={(e) => setCompanyName(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="audit-field">
                <span>Vertical</span>
                <input
                  type="text"
                  value={audit.vertical}
                  onChange={(e) => setVertical(e.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>
            {audit.competitors && audit.competitors.length > 0 && (
              <div className="audit-competitors">
                <h3 className="audit-competitors-title">Competitors</h3>
                <div className="audit-competitors-list">
                  {audit.competitors.map((c, i) => (
                    <div key={i} className="audit-competitor-row">
                      <input
                        type="text"
                        className="audit-competitor-input audit-competitor-name-input"
                        value={c.competitor_name}
                        placeholder="Competitor name"
                        onChange={(e) => onCompetitorChange(i, "competitor_name", e.target.value)}
                        autoComplete="off"
                      />
                      <input
                        type="url"
                        className="audit-competitor-input audit-competitor-url-input"
                        value={c.competitor_url}
                        placeholder="https://competitor.com"
                        onChange={(e) => onCompetitorChange(i, "competitor_url", e.target.value)}
                        autoComplete="off"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="audit-pages">
              {audit.pages.map((page, pageIndex) => (
                <div key={`${page.url}-${pageIndex}`} className="audit-data-page-wrap">
                  <AuditPageCard
                    page={page}
                    pageIndex={pageIndex}
                    vertical={audit.vertical}
                    hideAuditData={false}
                    onUrlChange={onUrlChange}
                    onPageTypeChange={onPageTypeChange}
                    onBestPracticesTextChange={onBestPracticesTextChange}
                    onRememberPageBestPractices={onRememberPageBestPractices}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "audit-report" && (
          <div className="audit-tab-panel">
            <div className="audit-result-header">
              <h2 className="audit-result-title">
                {audit.company_name ? audit.company_name : "Audit Report"}
              </h2>
            </div>
            <div className="audit-meta-row">
              <label className="audit-field">
                <span>Company name</span>
                <input type="text" value={audit.company_name} readOnly />
              </label>
              <label className="audit-field">
                <span>Vertical</span>
                <input type="text" value={audit.vertical} readOnly />
              </label>
            </div>
            <div className="audit-pages">
              {audit.pages.map((page, pageIndex) => (
                <div key={`report-${page.url}-${pageIndex}`} className="audit-page-card audit-data-page-wrap">
                  <h3 className="audit-page-heading">Page {pageIndex + 1}</h3>
                  <div className="audit-meta-row">
                    <label className="audit-field">
                      <span>URL</span>
                      <input type="url" value={page.url} readOnly />
                    </label>
                    <label className="audit-field">
                      <span>Page type</span>
                      <input type="text" value={page.page_type} readOnly />
                    </label>
                  </div>
                  {page.audit_status === "in_progress" && (
                    <p className="audit-task-status">Audit in progress…</p>
                  )}
                  {page.audit_status === "completed" && page.audit_result && (
                    <>
                      <div className="audit-practices-label-row">
                        <h4 className="audit-report-section-title">Report</h4>
                        <button
                          type="button"
                          className="audit-bp-toggle"
                          onClick={() => toggleReport(pageIndex)}
                          aria-expanded={expandedReports.has(pageIndex)}
                        >
                          {expandedReports.has(pageIndex) ? "Collapse" : "Expand"}
                        </button>
                      </div>
                      <div className={expandedReports.has(pageIndex) ? undefined : "audit-bp-collapsed"}>
                        <div className="audit-inline-result audit-task-result-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {page.audit_result}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "competitors" && (
          <div className="audit-tab-panel">
            <div className="audit-result-header">
              <h2 className="audit-result-title">Competitors</h2>
              {onRunCompetitors && audit.competitors && audit.competitors.length > 0 && !allCompetitorsComplete && (
                <button
                  type="button"
                  className="audit-run-button"
                  onClick={() => void onRunCompetitors()}
                  disabled={runningCompetitors}
                >
                  {runningCompetitors ? "Running..." : "Run Competitors"}
                </button>
              )}
            </div>
            {(!audit.competitors || audit.competitors.length === 0) ? (
              <p className="audit-tab-notice">No competitors added. Add competitors in the Audit Data tab.</p>
            ) : audit.pages.length === 0 ? (
              <p className="audit-tab-notice">No pages added yet.</p>
            ) : (
              <div className="competitors-page-grid">
                {Array.from(new Set(audit.pages.map((p) => p.page_type).filter(Boolean))).map((pageType) => (
                  <div key={pageType} className="competitors-page-card">
                    <h3 className="competitors-page-heading">{pageType}</h3>
                    <div className="competitors-page-list">
                      {audit.competitors!.map((c, ci) => {
                        const artifact = competitorArtifacts[audit.pages.findIndex((p) => p.page_type === pageType)]?.[ci];
                        const screenshotSrc = artifact?.screenshot?.trim()
                          ? artifact.screenshot.startsWith("gs://")
                            ? `/api/storage/image?path=${encodeURIComponent(artifact.screenshot)}`
                            : artifact.screenshot.startsWith("data:")
                              ? artifact.screenshot
                              : `data:image/png;base64,${artifact.screenshot}`
                          : null;
                        return (
                          <div key={ci} className="competitors-entry">
                            <div className="competitors-entry-text">
                              <span className="competitors-entry-name">{c.competitor_name || <em>Unnamed</em>}</span>
                              <span className="competitors-entry-url audit-competitor-url">{c.competitor_url || "—"}</span>
                              {artifact?.exists && !screenshotSrc && !artifact.result && (
                                <span className="competitors-entry-status">Task submitted</span>
                              )}
                              {artifact?.result && (
                                <p className="competitors-entry-result">{artifact.result}</p>
                              )}
                            </div>
                            {screenshotSrc && (
                              <div className="competitors-screenshot-wrap">
                                <Image
                                  src={screenshotSrc}
                                  alt={`Screenshot of ${c.competitor_name} ${pageType}`}
                                  className="audit-eyequant-img"
                                  width={440}
                                  height={956}
                                  unoptimized
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "guestimate" && (
          <div className="audit-tab-panel">
            <div className="audit-result-header">
              <h2 className="audit-result-title">Guestimate</h2>
              <div className="audit-result-actions">
                {guestimateDirty && onSaveGuestimate && (
                  <button
                    type="button"
                    className="audit-run-button"
                    onClick={() => void handleSaveGuestimate()}
                    disabled={savingGuestimate}
                  >
                    {savingGuestimate ? "Saving..." : "Save"}
                  </button>
                )}
                {onGuestimateRoi && !hasRoiDocument && (
                  <button
                    type="button"
                    className="audit-run-button"
                    onClick={() => void onGuestimateRoi()}
                    disabled={guestimatingRoi}
                  >
                    {guestimatingRoi ? "Guestimating..." : "Guestimate ROI"}
                  </button>
                )}
              </div>
            </div>
            <label className="audit-field">
              <span>ROI Estimate</span>
              <textarea
                className="guestimate-box audit-guestimate-textarea"
                rows={16}
                value={editedGuestimate}
                onChange={(e) => handleGuestimateChange(e.target.value)}
              />
            </label>
          </div>
        )}

        {activeTab === "eyequant" && (
          <div className="audit-tab-panel">
            <div className="audit-result-header">
              <h2 className="audit-result-title">EyeQuant</h2>
              {onRunEyeQuant && missingEyeshot && canCreateSlides && (
                <button
                  type="button"
                  className="audit-run-button"
                  onClick={() => void onRunEyeQuant()}
                  disabled={runningEyeQuant}
                >
                  {runningEyeQuant ? "Running EyeQuant..." : "Run EyeQuant"}
                </button>
              )}
            </div>
            {!canCreateSlides && (
              <p className="audit-tab-notice">
                Complete the audit for all pages before running EyeQuant.
              </p>
            )}
            <div className="audit-eyequant-grid">
              {audit.pages.map((page, pageIndex) => {
                const rawScreenshot = page.redo_screenshot?.trim() ? page.redo_screenshot : page.screenshot;
                const screenshotSrc = rawScreenshot?.trim()
                  ? rawScreenshot.startsWith("gs://")
                    ? `/api/storage/image?path=${encodeURIComponent(rawScreenshot)}`
                    : rawScreenshot.startsWith("data:")
                      ? rawScreenshot
                      : `data:image/png;base64,${rawScreenshot}`
                  : null;
                const eyeshotSrc = page.eyeshot?.trim()
                  ? page.eyeshot.startsWith("gs://")
                    ? `/api/storage/image?path=${encodeURIComponent(page.eyeshot)}`
                    : page.eyeshot.startsWith("data:")
                      ? page.eyeshot
                      : `data:image/png;base64,${page.eyeshot}`
                  : null;
                const claritySrc = page.clarity?.trim()
                  ? page.clarity.startsWith("gs://")
                    ? `/api/storage/image?path=${encodeURIComponent(page.clarity)}`
                    : page.clarity.startsWith("data:")
                      ? page.clarity
                      : `data:image/png;base64,${page.clarity}`
                  : null;
                return (
                  <div key={`eq-${pageIndex}`} className="audit-eyequant-page">
                    <div className="audit-eyequant-page-header">
                      <h3 className="audit-page-heading">
                        Page {pageIndex + 1}: {page.page_type}
                      </h3>
                      {onRedoEyeQuantPage && (
                        <button
                          type="button"
                          className="audit-redo-button"
                          onClick={() => void handleRedoPage(pageIndex)}
                          disabled={redoingEyeQuantPage !== null || runningEyeQuant}
                        >
                          {redoingEyeQuantPage === pageIndex ? "Redoing..." : "Redo"}
                        </button>
                      )}
                      {redoSubmittedPages.has(pageIndex) && (
                        <span className="audit-redo-success">redo screenshot task submitted</span>
                      )}
                    </div>
                    <p className="audit-eyequant-url">{page.url}</p>
                    <div className="audit-eyequant-images">
                      {screenshotSrc ? (
                        <div className="audit-eyequant-image-wrap">
                          <p className="audit-eyequant-image-label">Screenshot</p>
                          <Image
                            src={screenshotSrc}
                            alt={`Screenshot for page ${pageIndex + 1}`}
                            className="audit-eyequant-img"
                            width={440}
                            height={956}
                            unoptimized
                          />
                        </div>
                      ) : null}
                      {eyeshotSrc ? (
                        <div className="audit-eyequant-image-wrap">
                          <p className="audit-eyequant-image-label">Heatmap</p>
                          <Image
                            src={eyeshotSrc}
                            alt={`EyeQuant heatmap for page ${pageIndex + 1}`}
                            className="audit-eyequant-img"
                            width={440}
                            height={956}
                            unoptimized
                          />
                        </div>
                      ) : null}
                      {claritySrc ? (
                        <div className="audit-eyequant-image-wrap">
                          <p className="audit-eyequant-image-label">Clarity</p>
                          <Image
                            src={claritySrc}
                            alt={`EyeQuant clarity for page ${pageIndex + 1}`}
                            className="audit-eyequant-img"
                            width={440}
                            height={956}
                            unoptimized
                          />
                        </div>
                      ) : null}
                      {!screenshotSrc && !eyeshotSrc && !claritySrc && (
                        <p className="audit-tab-notice">
                          {page.audit_status !== "completed"
                            ? "Run the audit first to generate images."
                            : "Run EyeQuant to generate heatmaps."}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "slides" && (
          <div className="audit-tab-panel">
            <div className="audit-result-header">
              <h2 className="audit-result-title">Slides</h2>
              {onCreateSlides && !slidesUrl && (
                <button
                  type="button"
                  className="audit-run-button"
                  onClick={() => void onCreateSlides()}
                  disabled={!canCreateSlides || creatingSlides || missingEyeshot}
                >
                  {creatingSlides ? "Creating..." : "Create Slides"}
                </button>
              )}
            </div>
            {slidesUrl ? (
              <p className="slides-created-banner">
                Slides ready:{" "}
                <a href={slidesUrl} target="_blank" rel="noreferrer">
                  Open presentation
                </a>
              </p>
            ) : (
              <p className="audit-tab-notice">
                {!canCreateSlides
                  ? "Complete the audit on all pages first."
                  : missingEyeshot
                  ? "Run EyeQuant first to generate heatmaps."
                  : "Click 'Create Slides' to generate the presentation."}
              </p>
            )}
            {slideReports && slideReports.some(Boolean) && (
              <div className="slides-reports">
                {slideReports.map((report, pageIndex) => {
                  if (!report) return null;
                  const page = audit.pages[pageIndex];
                  const statusClass = report.status
                    ? `slides-status-badge slides-status-${report.status.toLowerCase()}`
                    : "slides-status-badge";
                  return (
                    <div key={`report-${pageIndex}`} className="slides-report-card">
                      <div className="slides-report-header">
                        <div className="slides-report-title-row">
                          <h3 className="slides-report-page-title">
                            Page {pageIndex + 1}: {page?.page_type ?? ""}
                          </h3>
                          {report.final_score != null && (
                            <span className="slides-score-badge">{report.final_score}/100</span>
                          )}
                          {report.status && (
                            <span className={statusClass}>{report.status}</span>
                          )}
                        </div>
                        {report.url && (
                          <p className="slides-report-url">{report.url}</p>
                        )}
                      </div>

                      {report.executive_summary && (
                        <div className="slides-section">
                          <h4 className="slides-section-title">Executive Summary</h4>
                          <p className="slides-executive-summary">{report.executive_summary}</p>
                        </div>
                      )}

                      {report.findings && report.findings.length > 0 && (
                        <div className="slides-section">
                          <h4 className="slides-section-title">Findings</h4>
                          <div className="slides-findings-list">
                            {report.findings.map((finding, fi) => (
                              <div key={fi} className="slides-finding-row">
                                <div className="slides-finding-meta">
                                  {finding.category && (
                                    <span className="slides-finding-category">{finding.category}</span>
                                  )}
                                  {finding.status && (
                                    <span className={`slides-status-badge slides-status-${finding.status.toLowerCase()}`}>
                                      {finding.status}
                                    </span>
                                  )}
                                  <span className="slides-finding-score">{finding.score}/2</span>
                                </div>
                                <p className="slides-finding-problem">{finding.problem_discovered}</p>
                                <p className="slides-finding-desc">{finding.description_of_problem}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {report.recommendations && report.recommendations.length > 0 && (
                        <div className="slides-section">
                          <h4 className="slides-section-title">Recommendations</h4>
                          <div className="slides-recs-list">
                            {report.recommendations.map((rec, ri) => (
                              <div key={ri} className="slides-rec-row">
                                <div className="slides-rec-meta">
                                  {rec.priority && (
                                    <span className={`slides-priority-badge slides-priority-${rec.priority.toLowerCase()}`}>
                                      {rec.priority}
                                    </span>
                                  )}
                                </div>
                                {rec.recommendation && (
                                  <p className="slides-rec-text">{rec.recommendation}</p>
                                )}
                                {rec.action && (
                                  <p className="slides-rec-action">Action: {rec.action}</p>
                                )}
                                {rec.impact && (
                                  <p className="slides-rec-impact">Impact: {rec.impact}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {report.media_metrics && (
                        <div className="slides-section">
                          <h4 className="slides-section-title">Media Metrics</h4>
                          <div className="slides-metrics-grid">
                            {report.media_metrics.currency && report.media_metrics.media_spend != null && (
                              <div className="slides-metric-item">
                                <span className="slides-metric-label">Media Spend</span>
                                <span className="slides-metric-value">
                                  {report.media_metrics.currency} {report.media_metrics.media_spend.toLocaleString()}
                                </span>
                              </div>
                            )}
                            {report.media_metrics.current_cvr != null && (
                              <div className="slides-metric-item">
                                <span className="slides-metric-label">Current CVR</span>
                                <span className="slides-metric-value">{report.media_metrics.current_cvr}%</span>
                              </div>
                            )}
                            {report.media_metrics.projected_cvr != null && (
                              <div className="slides-metric-item">
                                <span className="slides-metric-label">Projected CVR</span>
                                <span className="slides-metric-value">{report.media_metrics.projected_cvr}%</span>
                              </div>
                            )}
                            {report.media_metrics.cvr_lift != null && (
                              <div className="slides-metric-item">
                                <span className="slides-metric-label">CVR Lift</span>
                                <span className="slides-metric-value">+{report.media_metrics.cvr_lift}%</span>
                              </div>
                            )}
                            {report.media_metrics.revenue_opp != null && (
                              <div className="slides-metric-item">
                                <span className="slides-metric-label">Revenue Opportunity</span>
                                <span className="slides-metric-value">
                                  {report.media_metrics.currency ?? ""} {report.media_metrics.revenue_opp.toLocaleString()}
                                </span>
                              </div>
                            )}
                            {report.media_metrics.roi_percentage != null && (
                              <div className="slides-metric-item">
                                <span className="slides-metric-label">ROI</span>
                                <span className="slides-metric-value">{report.media_metrics.roi_percentage}%</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
