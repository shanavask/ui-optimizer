export type GutterRow = { key: string; label: string };

function probeLineHeightPx(textarea: HTMLTextAreaElement): number {
  if (typeof document === "undefined") {
    return 20;
  }
  const cs = getComputedStyle(textarea);
  const probe = document.createElement("div");
  probe.textContent = "M";
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;padding:0;margin:0;border:0;font:${cs.font};line-height:${cs.lineHeight};`;
  document.body.appendChild(probe);
  const h = probe.offsetHeight;
  document.body.removeChild(probe);
  const fallback = Math.round((parseFloat(cs.fontSize) || 16) * 1.45);
  return h > 0 ? h : fallback;
}

function contentInnerWidth(textarea: HTMLTextAreaElement): number {
  const cs = getComputedStyle(textarea);
  const pl = parseFloat(cs.paddingLeft) || 0;
  const pr = parseFloat(cs.paddingRight) || 0;
  return Math.max(0, textarea.clientWidth - pl - pr);
}

function measureWrappedHeight(
  textLine: string,
  innerWidth: number,
  font: string,
  lineHeight: string,
): number {
  if (typeof document === "undefined" || innerWidth <= 0) {
    return 0;
  }
  const m = document.createElement("div");
  m.textContent = textLine;
  m.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;width:${innerWidth}px;box-sizing:content-box;white-space:pre-wrap;overflow-wrap:anywhere;word-wrap:break-word;padding:0;margin:0;border:0;font:${font};line-height:${lineHeight};`;
  document.body.appendChild(m);
  const h = m.offsetHeight;
  document.body.removeChild(m);
  return h;
}

function visualRowsForSegment(
  segment: string,
  innerWidth: number,
  font: string,
  lineHeight: string,
  linePx: number,
): number {
  if (segment.length === 0) {
    return 1;
  }
  const block = measureWrappedHeight(segment, innerWidth, font, lineHeight);
  if (block <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(block / linePx - 1e-4));
}

function pushSegmentRows(
  rows: GutterRow[],
  segmentIndex: number,
  visualCount: number,
  label: string,
): void {
  for (let j = 0; j < visualCount; j += 1) {
    rows.push({
      key: `${segmentIndex}-${j}`,
      label: j === 0 ? label : "",
    });
  }
}

export function buildGutterRows(
  text: string,
  textarea: HTMLTextAreaElement,
): { rows: GutterRow[]; lineHeightPx: number } {
  const lineHeightPx = probeLineHeightPx(textarea);
  const cs = getComputedStyle(textarea);
  const inner = contentInnerWidth(textarea);
  const font = cs.font;
  const lineHeight = cs.lineHeight;
  const segments = text.split(/\r?\n/);
  const rows: GutterRow[] = [];
  let bulletIndex = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i] ?? "";
    const visual = visualRowsForSegment(seg, inner, font, lineHeight, lineHeightPx);
    const isSpacerLine = seg.trim().length === 0;
    const label = isSpacerLine ? "" : `${bulletIndex + 1}.`;
    pushSegmentRows(rows, i, visual, label);
    if (!isSpacerLine) {
      bulletIndex += 1;
    }
  }
  if (rows.length === 0) {
    rows.push({ key: "0-0", label: "1." });
  }
  return { rows, lineHeightPx };
}
