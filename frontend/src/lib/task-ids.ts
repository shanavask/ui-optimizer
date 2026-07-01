export function taskIdForPage(runId: string, pageIndex: number): string {
  return `${runId}_page_${pageIndex}`;
}

export function taskIdForRedoPage(runId: string, pageIndex: number): string {
  return `${runId}_page_${pageIndex}_redo`;
}

export function taskIdForCompetitor(runId: string, pageIndex: number, competitorIndex: number): string {
  return `${runId}_page_${pageIndex}_comp_${competitorIndex}`;
}
