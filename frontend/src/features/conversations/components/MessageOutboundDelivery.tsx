import React from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import CheckOutlinedIcon from '@mui/icons-material/CheckOutlined';
import DoneAllOutlinedIcon from '@mui/icons-material/DoneAllOutlined';
import ErrorOutlineOutlinedIcon from '@mui/icons-material/ErrorOutlineOutlined';
import HelpOutlineOutlinedIcon from '@mui/icons-material/HelpOutlineOutlined';
import type { ConversationMessage } from '../types/conversation.types';
import { resolveOutboundDeliveryUi } from '../utils/outboundDeliveryUi';

interface Props {
  message: ConversationMessage;
}

export const MessageOutboundDelivery: React.FC<Props> = ({ message }) => {
  const ui = resolveOutboundDeliveryUi(message);
  if (ui.visual === 'none') return null;

  const iconSx = { fontSize: '0.95rem', opacity: 0.9 };

  let icon: React.ReactNode;
  let title = '';

  switch (ui.visual) {
    case 'pending':
      icon = <ScheduleOutlinedIcon sx={iconSx} />;
      title = 'Enviando…';
      break;
    case 'sent':
      icon = <CheckOutlinedIcon sx={iconSx} />;
      title = 'Enviado';
      break;
    case 'delivered':
      icon = <DoneAllOutlinedIcon sx={iconSx} />;
      title = 'Entregado';
      break;
    case 'read':
      icon = <DoneAllOutlinedIcon sx={{ ...iconSx, color: 'info.light' }} />;
      title = 'Leído';
      break;
    case 'failed':
      icon = <ErrorOutlineOutlinedIcon sx={{ ...iconSx, color: 'error.light' }} />;
      title = ui.errorMessage || 'No entregado';
      break;
    case 'uncertain':
      icon = <HelpOutlineOutlinedIcon sx={iconSx} />;
      title = 'No se pudo confirmar el resultado del envío';
      break;
    default:
      return null;
  }

  return (
    <Box
      data-testid={`outbound-delivery-${ui.visual}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 0.5,
        mt: message.body?.trim() || (message.attachments?.length ?? 0) > 0 ? 0.5 : 0,
        minHeight: 18,
      }}
    >
      <Tooltip title={title}>
        <Box component="span" sx={{ display: 'inline-flex', lineHeight: 0 }} aria-label={title}>
          {icon}
        </Box>
      </Tooltip>
      {(ui.visual === 'failed' || ui.visual === 'uncertain') && ui.errorMessage && (
        <Typography variant="caption" sx={{ opacity: 0.85, maxWidth: 220 }} noWrap title={ui.errorMessage}>
          {ui.errorMessage}
        </Typography>
      )}
    </Box>
  );
};