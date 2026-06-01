"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

type BestPracticesNumberedFieldProps = Readonly<{
  id: string;
  labelId: string;
  value: string;
  rows: number;
  onChange: (next: string) => void;
}>;

export function BestPracticesNumberedField({
  id,
  labelId,
  value,
  rows,
  onChange,
}: BestPracticesNumberedFieldProps): React.JSX.Element {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const syncHeight = useCallback(() => {
    const textArea = textAreaRef.current;
    if (!textArea) {
      return;
    }
    textArea.style.height = "auto";
    textArea.style.height = `${textArea.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    syncHeight();
  }, [syncHeight, value]);

  return (
    <textarea
      ref={textAreaRef}
      id={id}
      className="audit-best-practices-box"
      value={value}
      rows={rows}
      wrap="soft"
      spellCheck
      aria-labelledby={labelId}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
