"use client";

import { useCallback } from "react";

import { textToBestPractices } from "@/lib/best-practices-text";
import type { PageAudit, UIAuditResponse } from "@/types/audit";

import { AuditPageCard } from "./AuditPageCard";

type AuditResultEditorProps = Readonly<{
  value: UIAuditResponse;
  onChange: (next: UIAuditResponse) => void;
  agentUsername?: string;
  hideAuditData?: boolean;
  loading?: boolean;
  onRunAudit?: () => Promise<void>;
  onCreateSlides?: () => Promise<void>;
  createSlidesLabel?: string;
  createSlidesBusyLabel?: string;
  onGuestimateRoi?: () => Promise<void>;
  createSlidesDisabled?: boolean;
  creatingSlides?: boolean;
  guestimatingRoi?: boolean;
  slidesUrl?: string | null;
  guestimateContent?: string;
}>;

function replacePage(pages: PageAudit[], index: number, page: PageAudit): PageAudit[] {
  const next = [...pages];
  next[index] = page;
  return next;
}

export function AuditResultEditor({
  value,
  onChange,
  agentUsername,
  hideAuditData = false,
  loading = false,
  onRunAudit,
  onCreateSlides,
  createSlidesLabel = "Create Slides",
  createSlidesBusyLabel = "Creating slides...",
  onGuestimateRoi,
  createSlidesDisabled = false,
  creatingSlides = false,
  guestimatingRoi = false,
  slidesUrl = null,
  guestimateContent = "",
}: AuditResultEditorProps): React.JSX.Element {
  const setCompanyName = useCallback(
    (company_name: string) => {
      onChange({ ...value, company_name });
    },
    [onChange, value],
  );

  const setVertical = useCallback(
    (vertical: string) => {
      onChange({ ...value, vertical });
    },
    [onChange, value],
  );

  const onUrlChange = useCallback(
    (index: number, url: string) => {
      const page = value.pages[index];
      if (!page) {
        return;
      }
      onChange({
        ...value,
        pages: replacePage(value.pages, index, { ...page, url }),
      });
    },
    [onChange, value],
  );

  const onPageTypeChange = useCallback(
    (index: number, page_type: string) => {
      const page = value.pages[index];
      if (!page) {
        return;
      }
      onChange({
        ...value,
        pages: replacePage(value.pages, index, { ...page, page_type }),
      });
    },
    [onChange, value],
  );

  const onBestPracticesTextChange = useCallback(
    (pageIndex: number, text: string) => {
      const page = value.pages[pageIndex];
      if (!page) {
        return;
      }
      const best_practices = textToBestPractices(text);
      onChange({
        ...value,
        pages: replacePage(value.pages, pageIndex, { ...page, best_practices }),
      });
    },
    [onChange, value],
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

  return (
    <section className="audit-result" aria-label="Audit data">
      <div className="audit-result-header">
        <h2 className="audit-result-title">
          {hideAuditData ? "Audit Results" : "Audit Data"}
        </h2>
        <div className="audit-result-actions">
          {!hideAuditData && onRunAudit ? (
            <button
              type="button"
              className="audit-run-button"
              onClick={onRunAudit}
              disabled={loading}
            >
              {loading ? "Running..." : "Run Audit"}
            </button>
          ) : null}
          {onCreateSlides ? (
            <button
              type="button"
              className="audit-run-button"
              onClick={onCreateSlides}
              disabled={createSlidesDisabled || creatingSlides}
            >
              {creatingSlides ? createSlidesBusyLabel : createSlidesLabel}
            </button>
          ) : null}
          {onGuestimateRoi ? (
            <button
              type="button"
              className="audit-run-button"
              onClick={onGuestimateRoi}
              disabled={guestimatingRoi}
            >
              {guestimatingRoi ? "Guestimating..." : "Guestimate ROI"}
            </button>
          ) : null}
        </div>
      </div>
      {slidesUrl ? (
        <p className="slides-created-banner">
          Slides created:{" "}
          <a href={slidesUrl} target="_blank" rel="noreferrer">
            Open presentation
          </a>
        </p>
      ) : null}
      {!hideAuditData ? (
        <>
          <label className="audit-field">
            <span>Company name</span>
            <input
              type="text"
              value={value.company_name}
              onChange={(e) => setCompanyName(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="audit-field">
            <span>Vertical</span>
            <input
              type="text"
              value={value.vertical}
              onChange={(e) => setVertical(e.target.value)}
              autoComplete="off"
            />
          </label>
        </>
      ) : null}
      {hideAuditData ? (
        <label className="audit-field">
          <span>Guestimate</span>
          <textarea
            className="guestimate-box"
            rows={8}
            value={guestimateContent}
            readOnly
          />
        </label>
      ) : null}
      <div className="audit-pages">
        {value.pages.map((page, pageIndex) => (
          <AuditPageCard
            key={`${page.url}-${pageIndex}`}
            page={page}
            pageIndex={pageIndex}
            vertical={value.vertical}
            hideAuditData={hideAuditData}
            onUrlChange={onUrlChange}
            onPageTypeChange={onPageTypeChange}
            onBestPracticesTextChange={onBestPracticesTextChange}
            onRememberPageBestPractices={onRememberPageBestPractices}
          />
        ))}
      </div>
    </section>
  );
}
