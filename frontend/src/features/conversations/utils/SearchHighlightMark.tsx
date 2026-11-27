import React from 'react';
import { Box } from '@mui/material';

export function SearchHighlightMark({
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