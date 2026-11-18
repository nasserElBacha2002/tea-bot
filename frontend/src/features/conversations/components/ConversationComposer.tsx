import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AttachFileOutlinedIcon from '@mui/icons-material/AttachFileOutlined';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import type { ConversationStatus } from '../types/conversation.types';
import { canOperatorReply } from '../utils/agentAssignment';
import { conversationUiDensity } from '../constants/conversationUiDensity';
import {
  INBOX_ATTACHMENT_ACCEPT,
  INBOX_MAX_OUTBOUND_FILES,
} from '../utils/inboxAttachmentPayload';
import { formatByteSize } from '../utils/formatByteSize';
import { createClientRequestId } from '../utils/clientRequestId';

export type ComposerFileStatus = 'idle' | 'sending' | 'ok' | 'error';

export interface ComposerFileItem {
  id: string;
  file: File;
  clientRequestId: string;
  status: ComposerFileStatus;
  errorMessage?: string | null;
  /** El caption ya viajó con este archivo en un intento anterior del lote. */
  includedCaption?: boolean;
  /** Indicador efímero para el lote en curso (reintentos sin repetir caption). */
  includeBody?: boolean;
}

export interface ComposerSendPayload {
  body: string;
  files: ComposerFileItem[];
  batchClientRequestId: string;
}

export interface ComposerSendResult {
  results?: Array<{ clientRequestId: string; ok: boolean; error?: { message?: string } }>;
}

interface Props {
  status: ConversationStatus;
  sending?: boolean;
  actionError?: string | null;
  successMessage?: string | null;
  compact?: boolean;
  canTakeover?: boolean;
  takeoverBlock?: string | null;
  assignedAgentLabel?: string | null;
  onSend: (payload: ComposerSendPayload) => Promise<ComposerSendResult | void>;
  onClaim?: () => Promise<void>;
  onTakeover?: () => Promise<void>;
  claiming?: boolean;
}

function CompactNotice({
  tone,
  children,
}: {
  tone: 'info' | 'warning';
  children: React.ReactNode;
}) {
  const Icon = tone === 'warning' ? WarningAmberOutlinedIcon : InfoOutlinedIcon;
  return (
    <Box
      role="status"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        minHeight: conversationUiDensity.composerNoticeHeight,
        maxHeight: conversationUiDensity.composerNoticeHeight,
        px: 1.25,
        py: 0.75,
        bgcolor: tone === 'warning' ? 'warning.light' : 'info.light',
        color: 'text.primary',
        borderTop: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Icon fontSize="small" color={tone === 'warning' ? 'warning' : 'info'} sx={{ flexShrink: 0 }} />
      <Typography
        variant="caption"
        noWrap
        title={typeof children === 'string' ? children : undefined}
        sx={{ fontSize: '0.8125rem', lineHeight: 1.3, minWidth: 0 }}
      >
        {children}
      </Typography>
    </Box>
  );
}

function isImageFile(file: File) {
  const mime = file.type?.toLowerCase() || '';
  return mime === 'image/jpeg' || mime === 'image/png';
}

function FileThumb({ file }: { file: File }) {
  const src = useMemo(() => (isImageFile(file) ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  if (!src) return null;
  return (
    <Box
      component="img"
      src={src}
      alt=""
      sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 0.5, flexShrink: 0 }}
    />
  );
}

export const ConversationComposer: React.FC<Props> = ({
  status,
  sending,
  actionError,
  successMessage,
  compact = false,
  onSend,
  onClaim,
  onTakeover,
  claiming,
  canTakeover = false,
  takeoverBlock = null,
  assignedAgentLabel = null,
}) => {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<ComposerFileItem[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendLockRef = useRef(false);

  if (status === 'closed') {
    return (
      <CompactNotice tone="info">
        No se puede responder una conversación cerrada.
      </CompactNotice>
    );
  }

  if (status === 'bot') {
    if (!canTakeover) {
      return (
        <CompactNotice tone="warning">
          Bot activo · La respuesta manual se habilitará al derivar a humano.
        </CompactNotice>
      );
    }
    return (
      <Box sx={{ flexShrink: 0 }}>
        <CompactNotice tone="info">
          Bot activo. Esta conversación puede tomarse manualmente. El campo de respuesta se habilita cuando el servidor confirma la toma.
        </CompactNotice>
        {canTakeover && (
          <Box sx={{ p: compact ? 1 : 1.25 }}>
            {actionError && (
              <Alert severity="error" sx={{ mb: 0.75, py: 0.25 }}>
                {actionError}
              </Alert>
            )}
            <Button
              variant="contained"
              fullWidth
              size="small"
              onClick={() => void onTakeover?.()}
              disabled={claiming}
              sx={{ minHeight: conversationUiDensity.controlHeight }}
            >
              {claiming ? 'Tomando…' : 'Tomar conversación'}
            </Button>
          </Box>
        )}
      </Box>
    );
  }

  if (takeoverBlock === 'owned_by_other') {
    const who = assignedAgentLabel?.trim() || 'otro agente';
    return (
      <Box sx={{ flexShrink: 0 }}>
        <CompactNotice tone="info">
          {`Atención humana. La conversación la está atendiendo ${who}.`}
        </CompactNotice>
        {actionError && (
          <Alert severity="error" sx={{ m: 1, py: 0.25 }}>
            {actionError}
          </Alert>
        )}
      </Box>
    );
  }

  if (!canOperatorReply(status)) {
    return null;
  }

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const addFiles = (picked: FileList | null) => {
    setFileError(null);
    if (!picked?.length) return;
    const allowed = INBOX_ATTACHMENT_ACCEPT.split(',');
    const next: ComposerFileItem[] = [];
    for (const file of Array.from(picked)) {
      const mime = file.type?.toLowerCase() || '';
      if (!allowed.includes(mime)) {
        setFileError('Solo se permiten imágenes JPEG/PNG o PDF.');
        continue;
      }
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        clientRequestId: createClientRequestId(),
        status: 'idle',
      });
    }
    if (!next.length) return;
    setFiles((prev) => {
      const merged = [...prev];
      for (const item of next) {
        if (merged.length >= INBOX_MAX_OUTBOUND_FILES) {
          setFileError(`Máximo ${INBOX_MAX_OUTBOUND_FILES} archivos por envío.`);
          break;
        }
        if (!merged.some((row) => row.id === item.id)) merged.push(item);
      }
      return merged;
    });
    if (inputRef.current) inputRef.current.value = '';
  };

  const pickSendItems = (retryFailedOnly: boolean) => {
    if (retryFailedOnly) {
      return files.filter((item) => item.status === 'error');
    }
    return files.filter((item) => item.status === 'idle' || item.status === 'error');
  };

  const handleSend = async (retryFailedOnly = false) => {
    const body = text.trim();
    const queue = pickSendItems(retryFailedOnly);
    if (!body && !queue.length) return;
    if (sending || sendLockRef.current) return;
    sendLockRef.current = true;
    const captionAlreadySent = files.some((item) => item.includedCaption);
    let captionPending = Boolean(body) && !captionAlreadySent;
    const queueWithCaption = queue.map((item) => {
      const includeBody = captionPending;
      if (includeBody) captionPending = false;
      return { ...item, includeBody };
    });
    setFiles((prev) => prev.map((item) => (
      queue.some((q) => q.id === item.id) ? { ...item, status: 'sending', errorMessage: null } : item
    )));
    try {
      const response = await onSend({
        body,
        files: queueWithCaption,
        batchClientRequestId: createClientRequestId(),
      });
      if (response?.results?.length) {
        const byClient = new Map(response.results.map((row) => [row.clientRequestId, row]));
        setFiles((prev) => {
          const next = prev.map((item) => {
            const row = byClient.get(item.clientRequestId);
            if (!row) return item;
            const status: ComposerFileStatus = row.ok ? 'ok' : 'error';
            const sentItem = queueWithCaption.find((q) => q.clientRequestId === item.clientRequestId);
            return {
              ...item,
              status,
              includedCaption: item.includedCaption || Boolean(row.ok && sentItem?.includeBody),
              errorMessage: row.ok ? null : row.error?.message || 'No se pudo enviar',
            };
          });
          return next.filter((item) => item.status !== 'ok');
        });
        if (response.results.every((row) => row.ok)) setText('');
      } else {
        setText('');
        setFiles([]);
      }
    } finally {
      sendLockRef.current = false;
    }
  };

  const hasFailed = files.some((item) => item.status === 'error');
  const exclusiveAttention = takeoverBlock != null && takeoverBlock !== 'disabled';
  const pausedNotice = exclusiveAttention && (status === 'assigned' || status === 'paused')
    ? takeoverBlock === 'shared_inbox'
      ? assignedAgentLabel
        ? `Atención humana. La tomó ${assignedAgentLabel}. Podés seguir respondiendo.`
        : 'Atención humana. Otro agente la tomó. Podés seguir respondiendo.'
      : assignedAgentLabel
        ? `Atención humana. Atiende ${assignedAgentLabel}.`
        : 'Atención humana. Estás atendiendo esta conversación.'
    : null;
  const showComposer = !canTakeover || status === 'assigned' || status === 'paused';
  const canSubmit = Boolean(text.trim() || files.length) && !sending;

  return (
    <Box sx={{ p: compact ? 1 : 1.25, flexShrink: 0 }}>
      {pausedNotice && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
          {pausedNotice}
        </Typography>
      )}
      {(canTakeover || status === 'waiting_human') && (
        <Button
          variant="outlined"
          fullWidth
          size="small"
          onClick={() => void (canTakeover ? onTakeover?.() : onClaim?.())}
          disabled={claiming}
          sx={{ mb: 0.75, minHeight: conversationUiDensity.controlHeight }}
        >
          {claiming ? 'Tomando…' : 'Tomar conversación'}
        </Button>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 0.75, py: 0.25, '& .MuiAlert-message': { fontSize: '0.8125rem' } }}>
          {successMessage}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mb: 0.75, py: 0.25, '& .MuiAlert-message': { fontSize: '0.8125rem' } }}>
          {actionError}
        </Alert>
      )}
      {fileError && (
        <Alert severity="warning" sx={{ mb: 0.75, py: 0.25, '& .MuiAlert-message': { fontSize: '0.8125rem' } }}>
          {fileError}
        </Alert>
      )}
      {showComposer && (
        <>
          {files.length > 0 && (
            <Stack spacing={0.5} sx={{ mb: 0.75 }}>
              {files.map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    p: 0.75,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    bgcolor: 'background.paper',
                  }}
                >
                  <Stack direction="row" spacing={1} alignItems="center">
                    <FileThumb file={item.file} />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="caption" noWrap title={item.file.name}>
                        {item.file.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {formatByteSize(item.file.size)}
                        {item.status === 'sending' ? ' · Enviando…' : ''}
                        {item.status === 'ok' ? ' · Enviado' : ''}
                        {item.status === 'error' ? ` · ${item.errorMessage || 'Error'}` : ''}
                      </Typography>
                    </Box>
                    {item.status === 'ok' && <CheckCircleOutlineIcon fontSize="small" color="success" />}
                    {item.status === 'error' && <ErrorOutlineIcon fontSize="small" color="error" />}
                    {item.status !== 'sending' && (
                      <IconButton
                        size="small"
                        aria-label="Quitar archivo"
                        onClick={() => removeFile(item.id)}
                        disabled={sending}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
          <Stack direction="row" spacing={1} alignItems="flex-end">
            <input
              ref={inputRef}
              type="file"
              accept={INBOX_ATTACHMENT_ACCEPT}
              multiple
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
            <IconButton
              size="small"
              aria-label="Adjuntar archivos"
              disabled={sending || files.length >= INBOX_MAX_OUTBOUND_FILES}
              onClick={() => inputRef.current?.click()}
              sx={{ flexShrink: 0, mb: 0.25 }}
            >
              <AttachFileOutlinedIcon fontSize="small" />
            </IconButton>
            <TextField
              fullWidth
              multiline
              minRows={1}
              maxRows={compact ? 4 : 5}
              label="Responder"
              placeholder="Escribí una respuesta…"
              size="small"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={sending}
              sx={{
                '& .MuiInputBase-root': { minHeight: conversationUiDensity.controlHeight },
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend(false);
                }
              }}
            />
            <Button
              variant="contained"
              size="small"
              onClick={() => void handleSend(false)}
              disabled={!canSubmit}
              sx={{ flexShrink: 0, minHeight: conversationUiDensity.controlHeight }}
            >
              {sending ? '…' : 'Enviar'}
            </Button>
          </Stack>
          {hasFailed && !sending && (
            <Button
              size="small"
              variant="text"
              sx={{ mt: 0.5, alignSelf: 'flex-start' }}
              onClick={() => void handleSend(true)}
            >
              Reintentar archivos fallidos
            </Button>
          )}
        </>
      )}
    </Box>
  );
};

/** Actualiza estados de archivo tras respuesta de lote (expuesto para la página). */
export function applyComposerBatchResults(
  files: ComposerFileItem[],
  results: Array<{ clientRequestId: string; ok: boolean; error?: { message?: string } }>,
): ComposerFileItem[] {
  const byId = new Map(results.map((row) => [row.clientRequestId, row]));
  return files.map((item) => {
    const row = byId.get(item.clientRequestId);
    if (!row) return item;
    return {
      ...item,
      status: row.ok ? 'ok' : 'error',
      errorMessage: row.ok ? null : row.error?.message || 'No se pudo enviar',
    };
  });
}