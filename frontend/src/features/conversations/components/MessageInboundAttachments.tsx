import React, { useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import BrokenImageOutlinedIcon from '@mui/icons-material/BrokenImageOutlined';
import type { ConversationMessage, ConversationMessageAttachment } from '../types/conversation.types';
import { conversationAttachmentContentUrl } from '../api/conversationsApi';
import { formatByteSize } from '../utils/formatByteSize';

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

const thumbSx = {
  display: 'block',
  maxWidth: '100%',
  width: 'auto',
  maxHeight: 220,
  borderRadius: 1,
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
      <Box sx={{ mt: 0.5 }}>
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
          sx={{ mt: 0.5, minWidth: 0, px: 0.5, color: 'text.primary' }}
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

function PdfAttachment({
  message,
  attachment,
}: {
  message: ConversationMessage;
  attachment: ConversationMessageAttachment;
}) {
  const downloadUrl = conversationAttachmentContentUrl(
    message.conversationId,
    message.id,
    attachment.id,
    { download: true },
  );

  return (
    <Stack
      direction="row"
      spacing={1}
      alignItems="center"
      sx={{
        mt: 0.5,
        px: 1,
        py: 0.75,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <PictureAsPdfOutlinedIcon color="error" fontSize="small" />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" color="text.primary" noWrap title={attachmentLabel(attachment)}>
          {attachmentLabel(attachment)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          PDF · {formatByteSize(attachment.byteSize)}
        </Typography>
      </Box>
      <IconButton
        component="a"
        href={downloadUrl}
        size="small"
        aria-label="Descargar PDF"
        sx={{ color: 'text.primary' }}
      >
        <DownloadOutlinedIcon fontSize="small" />
      </IconButton>
    </Stack>
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
    <Stack
      spacing={0.75}
      sx={{
        mt: message.body?.trim() ? 0.75 : 0,
        // Burbujas outbound (agente/bot) fuerzan color claro; los chips usan fondo paper.
        color: 'text.primary',
      }}
    >
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
          return <PdfAttachment key={attachment.id} message={message} attachment={attachment} />;
        }
        return (
          <Button
            key={attachment.id}
            size="small"
            color="inherit"
            sx={{ color: 'text.primary', justifyContent: 'flex-start' }}
            startIcon={<DownloadOutlinedIcon />}
            href={conversationAttachmentContentUrl(
              message.conversationId,
              message.id,
              attachment.id,
              { download: true },
            )}
          >
            {attachmentLabel(attachment)}
          </Button>
        );
      })}
    </Stack>
  );
};