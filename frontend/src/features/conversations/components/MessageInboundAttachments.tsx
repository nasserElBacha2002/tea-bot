import React, { useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  Stack,
  Typography,
} from '@mui/material';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import type { ConversationMessage, ConversationMessageAttachment } from '../types/conversation.types';
import { conversationAttachmentContentUrl } from '../api/conversationsApi';
import { formatByteSize } from '../utils/formatByteSize';
import {
  messageIsAttachmentOnly,
  resolveMessageBubbleRole,
} from '../utils/conversationMessageDisplay';

interface Props {
  message: ConversationMessage;
}

function isImageMime(mime: string | null | undefined): boolean {
  const value = String(mime || '').toLowerCase();
  return value === 'image/jpeg' || value === 'image/png';
}

function isPdfMime(mime: string | null | undefined): boolean {
  return String(mime || '').toLowerCase() === 'application/pdf';
}

function attachmentLabel(att: ConversationMessageAttachment): string {
  if (att.originalName?.trim()) return att.originalName.trim();
  if (isPdfMime(att.mimeType)) return 'Documento PDF';
  if (isImageMime(att.mimeType)) return 'Imagen';
  return 'Adjunto';
}

function fileKindLabel(mime: string | null | undefined): string {
  if (isPdfMime(mime)) return 'PDF';
  const value = String(mime || '').toLowerCase();
  if (value.startsWith('image/')) return 'Imagen';
  if (value.includes('spreadsheet') || value.includes('excel')) return 'Hoja de cálculo';
  if (value.includes('word') || value.includes('document')) return 'Documento';
  return 'Archivo';
}

/** Fondo del chip de documento según burbuja padre (texto vs solo adjunto). */
function documentCardSurface(message: ConversationMessage): {
  bgcolor: string;
  border: string;
  borderColor: string;
  iconBg: string;
  iconColor: 'error' | 'inherit';
  metaColor: 'text.secondary' | 'inherit';
} {
  const role = resolveMessageBubbleRole(message);
  const onColoredBubble =
    !messageIsAttachmentOnly(message) && role !== 'user' && role !== 'system';

  if (onColoredBubble) {
    return {
      bgcolor: 'rgba(255,255,255,0.14)',
      border: '1px solid',
      borderColor: 'rgba(255,255,255,0.22)',
      iconBg: 'rgba(255,255,255,0.2)',
      iconColor: 'inherit',
      metaColor: 'inherit',
    };
  }

  return {
    bgcolor: 'grey.50',
    border: 'none',
    borderColor: 'transparent',
    iconBg: 'background.paper',
    iconColor: 'error',
    metaColor: 'text.secondary',
  };
}

const thumbSx = {
  display: 'block',
  maxWidth: '100%',
  width: 'auto',
  maxHeight: 220,
  borderRadius: 1.5,
  cursor: 'pointer',
  objectFit: 'cover' as const,
};

function ImageAttachment({
  message,
  attachment,
}: {
  message: ConversationMessage;
  attachment: ConversationMessageAttachment;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const src = conversationAttachmentContentUrl(message.conversationId, message.id, attachment.id);
  const downloadUrl = conversationAttachmentContentUrl(
    message.conversationId,
    message.id,
    attachment.id,
    { download: true },
  );

  if (error) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
        <BrokenImageOutlinedIcon fontSize="small" color="disabled" />
        <Typography variant="caption" color="text.secondary">
          No se pudo cargar la imagen
        </Typography>
      </Stack>
    );
  }

  return (
    <>
      <Box sx={{ mt: 0.25 }}>
        <Box
          component="img"
          src={src}
          alt={attachmentLabel(attachment)}
          sx={thumbSx}
          onClick={() => setOpen(true)}
          onError={() => setError(true)}
          loading="lazy"
        />
        <Button
          size="small"
          color="inherit"
          startIcon={<DownloadOutlinedIcon />}
          href={downloadUrl}
          sx={{ mt: 0.5, minWidth: 0, px: 0.5, color: 'text.secondary' }}
        >
          Descargar
        </Button>
      </Box>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogContent sx={{ p: 1, bgcolor: 'grey.900' }}>
          <Box
            component="img"
            src={src}
            alt={attachmentLabel(attachment)}
            sx={{ width: '100%', height: 'auto', maxHeight: '80vh', objectFit: 'contain' }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function DocumentAttachmentCard({
  message,
  attachment,
  kind,
}: {
  message: ConversationMessage;
  attachment: ConversationMessageAttachment;
  kind: 'pdf' | 'file';
}) {
  const downloadUrl = conversationAttachmentContentUrl(
    message.conversationId,
    message.id,
    attachment.id,
    { download: true },
  );
  const surface = documentCardSurface(message);
  const label = attachmentLabel(attachment);
  const size = formatByteSize(attachment.byteSize);
  const meta = size ? `${fileKindLabel(attachment.mimeType)} · ${size}` : fileKindLabel(attachment.mimeType);
  const Icon = kind === 'pdf' ? PictureAsPdfOutlinedIcon : InsertDriveFileOutlinedIcon;

  return (
    <Box
      component="a"
      href={downloadUrl}
      download
      aria-label={`Descargar ${label}`}
      sx={{
        mt: 0.25,
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1.25,
        py: 1,
        minWidth: { xs: 200, sm: 240 },
        maxWidth: '100%',
        borderRadius: 1.5,
        textDecoration: 'none',
        color: 'inherit',
        bgcolor: surface.bgcolor,
        border: surface.border,
        borderColor: surface.borderColor,
        transition: 'background-color 0.15s ease',
        '&:hover': {
          bgcolor:
            surface.border === 'none' ? 'action.hover' : 'rgba(255,255,255,0.22)',
        },
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: 1.25,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: surface.iconBg,
          border: surface.border === 'none' ? '1px solid' : 'none',
          borderColor: 'divider',
        }}
      >
        <Icon fontSize="small" color={surface.iconColor} />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight={500} noWrap title={label} sx={{ lineHeight: 1.35 }}>
          {label}
        </Typography>
        <Typography variant="caption" color={surface.metaColor} noWrap sx={{ display: 'block', mt: 0.15 }}>
          {meta}
        </Typography>
      </Box>
      <DownloadOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
    </Box>
  );
}

function PendingAttachment() {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
      <CircularProgress size={14} />
      <Typography variant="caption" color="text.secondary">
        Procesando adjunto…
      </Typography>
    </Stack>
  );
}

function FailedAttachment() {
  return (
    <Typography variant="caption" color="warning.main" sx={{ display: 'block', py: 0.25 }}>
      No se pudo obtener el adjunto
    </Typography>
  );
}

export const MessageInboundAttachments: React.FC<Props> = ({ message }) => {
  const items = message.attachments ?? [];
  if (!items.length) return null;

  return (
    <Stack spacing={0.5} sx={{ mt: message.body?.trim() ? 0.75 : 0, color: 'text.primary' }}>
      {items.map((attachment) => {
        if (attachment.status === 'pending' || attachment.status === 'downloading') {
          return <PendingAttachment key={attachment.id} />;
        }
        if (attachment.status === 'failed') {
          return <FailedAttachment key={attachment.id} />;
        }
        if (attachment.status !== 'stored') {
          return <FailedAttachment key={attachment.id} />;
        }
        if (isImageMime(attachment.mimeType)) {
          return <ImageAttachment key={attachment.id} message={message} attachment={attachment} />;
        }
        if (isPdfMime(attachment.mimeType)) {
          return (
            <DocumentAttachmentCard
              key={attachment.id}
              message={message}
              attachment={attachment}
              kind="pdf"
            />
          );
        }
        return (
          <DocumentAttachmentCard
            key={attachment.id}
            message={message}
            attachment={attachment}
            kind="file"
          />
        );
      })}
    </Stack>
  );
};