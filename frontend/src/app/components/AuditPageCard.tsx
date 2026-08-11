"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { bestPracticesToText } from "@/lib/best-practices-text";
import type { PageAudit } from "@/types/audit";

import { BestPracticesNumberedField } from "./BestPracticesNumberedField";

type AuditPageCardProps = Readonly<{
  page: PageAudit;
  pageIndex: number;
  vertical: string;
  hideAuditData?: boolean;
  onUrlChange: (index: number, value: string) => void;
  onPageTypeChange: (index: number, value: string) => void;
  onBestPracticesTextChange: (pageIndex: number, text: string) => void;
  onRememberPageBestPractices: (
    vertical: string,
    pageType: string,
    bestPractices: string,
  ) => Promise<void>;
}>;

export function AuditPageCard({
  page,
  pageIndex,
  vertical,
  hideAuditData = false,
  onUrlChange,
  onPageTypeChange,
  onBestPracticesTextChange,
  onRememberPageBestPractices,
}: AuditPageCardProps): React.JSX.Element {
  const bpText = bestPracticesToText(page.best_practices);
  const [bpExpanded, setBpExpanded] = useState(false);
  const [rememberingPage, setRememberingPage] = useState(false);
  const [rememberStatus, setRememberStatus] = useState<string | null>(null);
  const [rememberError, setRememberError] = useState<string | null>(null);
  const allBestPractices = page.best_practices
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  const handleRemember = useCallback(
    async () => {
      const numberedBestPractices = allBestPractices
        .map((item, index) => `${index + 1}. ${item}`)
        .join("\n");
      setRememberStatus(null);
      setRememberError(null);
      setRememberingPage(true);
      try {
        await onRememberPageBestPractices(
          vertical,
          page.page_type,
          numberedBestPractices,
        );
        setRememberStatus("Saved.");
      } catch (err) {
        const detail = err instanceof Error ? err.message : "Save failed.";
        setRememberError(detail);
      } finally {
        setRememberingPage(false);
      }
    },
    [allBestPractices, onRememberPageBestPractices, page.page_type, vertical],
  );

  const screenshotSrc = page.screenshot?.trim()
    ? page.screenshot.startsWith("gs://")
      ? `/api/storage/image?path=${encodeURIComponent(page.screenshot)}`
      : page.screenshot.startsWith("data:")
        ? page.screenshot
        : `data:image/png;base64,${page.screenshot}`
    : null;
  const eyeshotSrc = page.eyeshot?.trim()
    ? page.eyeshot.startsWith("gs://")
      ? `/api/storage/image?path=${encodeURIComponent(page.eyeshot)}`
      : page.eyeshot.startsWith("data:")
        ? page.eyeshot
        : `data:image/png;base64,${page.eyeshot}`
    : null;

  return (
    <div className="audit-page-card">
      <h3 className="audit-page-heading">Page {pageIndex + 1}</h3>
      {!hideAuditData ? (
        <>
          <div className="audit-meta-row">
            <label className="audit-field">
              <span>URL</span>
              <input
                type="url"
                value={page.url}
                onChange={(e) => onUrlChange(pageIndex, e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="audit-field">
              <span>Page type</span>
              <input
                type="text"
                value={page.page_type}
                onChange={(e) => onPageTypeChange(pageIndex, e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
          <div className="audit-practices">
            <div className="audit-practices-label-row">
              <span
                className="audit-practices-label-wrap"
                id={`bp-label-${pageIndex}`}
              >
                Best practices
                {!bpExpanded && allBestPractices.length > 0 && (
                  <span className="audit-bp-count"> ({allBestPractices.length})</span>
                )}
              </span>
              <button
                type="button"
                className="audit-bp-toggle"
                onClick={() => setBpExpanded((v) => !v)}
                aria-expanded={bpExpanded}
                aria-controls={`bp-${pageIndex}`}
              >
                {bpExpanded ? "Collapse" : "Expand"}
              </button>
            </div>
            <div className={bpExpanded ? undefined : "audit-bp-collapsed"}>
              <BestPracticesNumberedField
                id={`bp-${pageIndex}`}
                labelId={`bp-label-${pageIndex}`}
                value={bpText}
                rows={8}
                onChange={(t) => onBestPracticesTextChange(pageIndex, t)}
              />
            </div>
          </div>
        </>
      ) : null}
      {hideAuditData && page.audit_status === "in_progress" ? (
        <p className="audit-task-status">Audit result: In progress</p>
      ) : null}
      {hideAuditData && page.audit_status === "completed" ? (
        <div className="audit-task-result">
          <p className="audit-task-status">Audit result: Completed</p>
          <div className="audit-task-result-markdown">
            {hideAuditData && (screenshotSrc || eyeshotSrc) ? (
              <div className="audit-image-stack-inline">
                {screenshotSrc ? (
                  <Image
                    src={screenshotSrc}
                    alt={`Screenshot for page ${pageIndex + 1}`}
                    className="audit-screenshot audit-screenshot-inline"
                    width={440}
                    height={956}
                    unoptimized
                  />
                ) : null}
                {eyeshotSrc ? (
                  <Image
                    src={eyeshotSrc}
                    alt={`EyeQuant heatmap for page ${pageIndex + 1}`}
                    className="audit-screenshot audit-screenshot-inline"
                    width={440}
                    height={956}
                    unoptimized
                  />
                ) : null}
              </div>
            ) : null}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {page.audit_result ?? ""}
            </ReactMarkdown>
          </div>
        </div>
      ) : null}
      {!hideAuditData ? (
        <>
          <button
            type="button"
            className="audit-remember-button"
            onClick={() => void handleRemember()}
            disabled={
              !vertical.trim() ||
              !page.page_type.trim() ||
              allBestPractices.length === 0 ||
              rememberingPage
            }
          >
            {rememberingPage ? "Saving..." : "Remember these best practices"}
          </button>
          {rememberStatus ? <p className="audit-remember-status">{rememberStatus}</p> : null}
          {rememberError ? (
            <p className="audit-remember-error" role="alert">
              {rememberError}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
