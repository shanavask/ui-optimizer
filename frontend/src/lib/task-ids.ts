export function taskIdForPage(runId: string, pageIndex: number): string {
  return `${runId}_page_${pageIndex}`;
}
