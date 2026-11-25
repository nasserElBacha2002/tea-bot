import React from 'react';
import { Box } from '@mui/material';

function BoxHighlight({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <Box
      component="mark"
      sx={{
        bgcolor: active ? 'warning.light' : 'warning.main',
        color: 'inherit',
        px: 0.25,
        borderRadius: 0.5,
      }}
    >
      {children}
    </Box>
  );
}

export function renderHighlightedText(
  text: string,
  start: number,
  end: number,
  options: { active?: boolean } = {},
): React.ReactNode {
  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart, Math.min(end, text.length));
  if (safeEnd <= safeStart) return text;
  const before = text.slice(0, safeStart);
  const match = text.slice(safeStart, safeEnd);
  const after = text.slice(safeEnd);
  return (
    <>
      {before}
      <BoxHighlight active={options.active}>{match}</BoxHighlight>
      {after}
    </>
  );
}

function mapNormalizedIndexToOriginal(original: string, normIndex: number): number {
  let normPos = 0;
  let codeUnitIndex = 0;
  for (const char of [...original]) {
    if (normPos >= normIndex) return codeUnitIndex;
    const segment = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    normPos += segment.length;
    codeUnitIndex += char.length;
  }
  return original.length;
}

export function highlightTermInPlainText(body: string, term: string): React.ReactNode {
  const trimmed = term.trim();
  if (!trimmed) return body;
  const normBody = body.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const normTerm = trimmed.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const idx = normBody.indexOf(normTerm);
  if (idx < 0) return body;
  const start = mapNormalizedIndexToOriginal(body, idx);
  const end = mapNormalizedIndexToOriginal(body, idx + normTerm.length);
  return renderHighlightedText(body, start, end);
}