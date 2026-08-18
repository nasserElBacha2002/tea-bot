import React from 'react';
import { Box } from '@mui/material';

interface Props {
  width: number;
  minWidth: number;
  maxWidth: number;
  onPointerDown: (clientX: number) => void;
  onKeyboardNudge: (delta: number) => void;
}

export const ConversationSidebarResizeHandle: React.FC<Props> = ({
  width,
  minWidth,
  maxWidth,
  onPointerDown,
  onKeyboardNudge,
}) => (
  <Box
    role="separator"
    aria-orientation="vertical"
    aria-label="Redimensionar panel de conversaciones"
    aria-valuemin={minWidth}
    aria-valuemax={maxWidth}
    aria-valuenow={Math.round(width)}
    tabIndex={0}
    data-testid="conversation-sidebar-resize-handle"
    onPointerDown={(event) => {
      event.preventDefault();
      onPointerDown(event.clientX);
    }}
    onKeyDown={(event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onKeyboardNudge(-16);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        onKeyboardNudge(16);
      }
    }}
    sx={{
      width: 6,
      flexShrink: 0,
      cursor: 'col-resize',
      bgcolor: 'transparent',
      position: 'relative',
      '&:hover::after, &:focus-visible::after': {
        opacity: 1,
      },
      '&::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: '50%',
        width: 2,
        transform: 'translateX(-50%)',
        bgcolor: 'divider',
        opacity: 0,
        transition: 'opacity 0.15s ease',
      },
    }}
  />
);
