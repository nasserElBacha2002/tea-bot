import React, { useState } from 'react';
import {
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Button,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  ListItemText,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import type { ConversationDetailResponse } from '../types/conversation.types';
import { ConversationStatusBadge } from './ConversationStatusBadge';
import { ConversationMessageTimeline } from './ConversationMessageTimeline';
import { ConversationComposer } from './ConversationComposer';
import { ContactNameEditor } from './ContactNameEditor';
import type { ConversationMessage } from '../types/conversation.types';
import {
  formatConversationHeaderMeta,
  handoffReasonHumanText,
} from '../utils/conversationDisplay';
import { formatConversationTitle } from '../utils/conversationUiLabels';
import { conversationUiDensity } from '../constants/conversationUiDensity';

interface Props {
  detail: ConversationDetailResponse | undefined;
  messages: ConversationMessage[];
  conversationId?: string | null;
  loadingDetail?: boolean;
  loadingMessages?: boolean;
  detailError?: string | null;
  messagesError?: string | null;
  sending?: boolean;
  claiming?: boolean;
  closing?: boolean;
  savingContact?: boolean;
  contactError?: string | null;
  actionError?: string | null;
  successMessage?: string | null;
  readAt?: string | null;
  onCaughtUp?: (readThroughAt: string) => void;
  onSend: (body: string) => Promise<void>;
  onClaim: () => Promise<void>;
  onClose: () => Promise<void>;
  onUpdateContact: (name: string) => Promise<void>;
  onBack?: () => void;
}

export const ConversationDetail: React.FC<Props> = ({
  detail,
  messages,
  conversationId,
  loadingDetail,
  loadingMessages,
  detailError,
  messagesError,
  sending,
  claiming,
  closing,
  savingContact,
  contactError,
  actionError,
  successMessage,
  readAt = null,
  onCaughtUp,
  onSend,
  onClaim,
  onClose,
  onUpdateContact,
  onBack,
}) => {
  const theme = useTheme();
  const isMobileViewport = useMediaQuery(theme.breakpoints.down('md'));
  const isCompactDetail = isMobileViewport || Boolean(onBack);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);

  if (loadingDetail) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, minHeight: 0 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (detailError) {
    return <Alert severity="error" sx={{ m: 1 }}>{detailError}</Alert>;
  }

  if (!detail) {
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 2,
        }}
      >
        <Typography color="text.secondary" textAlign="center" variant="body2">
          Seleccioná una conversación para ver el detalle
        </Typography>
      </Box>
    );
  }

  const { conversation, humanHandoff } = detail;
  const title = formatConversationTitle(conversation.phoneNumber, conversation.displayName);
  const headerMeta = formatConversationHeaderMeta(
    conversation.channel,
    conversation.provider,
    conversation.lastMessageAt,
  );
  const motivo =
    handoffReasonHumanText(humanHandoff?.reason)
    ?? (conversation.status === 'waiting_human'
      ? 'Esperando que un operador tome la conversación.'
      : null);

  const canClose = conversation.status !== 'closed';
  const showClaimInHeader = conversation.status === 'waiting_human';

  const handleClose = async () => {
    if (!closeConfirm) {
      setCloseConfirm(true);
      return;
    }
    await onClose();
    setCloseConfirm(false);
  };

  const closeButtonLabel = closeConfirm
    ? isCompactDetail
      ? 'Confirmar'
      : 'Confirmar cierre'
    : isCompactDetail
      ? 'Cerrar'
      : 'Cerrar y devolver al bot';

  const headerActions = (
    <Stack direction="row" spacing={0.5} alignItems="center" flexShrink={0}>
      {closeConfirm && (
        <Button size="small" onClick={() => setCloseConfirm(false)} sx={{ minWidth: 0, px: 1 }}>
          No
        </Button>
      )}
      {showClaimInHeader && (
        <Button
          size="small"
          variant="contained"
          color="primary"
          onClick={() => void onClaim()}
          disabled={claiming}
          sx={{ minHeight: 32, px: 1, whiteSpace: 'nowrap', display: { xs: 'none', sm: 'inline-flex' } }}
        >
          {claiming ? '…' : 'Tomar'}
        </Button>
      )}
      {canClose && (
        <Button
          size="small"
          variant={closeConfirm ? 'contained' : 'outlined'}
          color="error"
          onClick={() => void handleClose()}
          disabled={closing}
          sx={{ minHeight: 32, px: 1, whiteSpace: 'nowrap' }}
        >
          {closing ? '…' : closeButtonLabel}
        </Button>
      )}
      <IconButton
        size="small"
        aria-label="Más acciones de la conversación"
        onClick={(e) => setMenuAnchor(e.currentTarget)}
        sx={{ flexShrink: 0 }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
    </Stack>
  );

  const detailHeader = (
    <Stack spacing={contactError ? 0.5 : 0} sx={{ width: '100%', minWidth: 0 }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.75}
        sx={{
          minHeight: conversationUiDensity.headerHeight,
          maxHeight: conversationUiDensity.headerHeight,
          width: '100%',
          minWidth: 0,
          flexWrap: 'nowrap',
        }}
      >
        {onBack && (
          <IconButton
            onClick={onBack}
            aria-label="Volver a la lista"
            edge="start"
            size="small"
            sx={{ flexShrink: 0 }}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        )}

        <Typography
          variant="body1"
          fontWeight={700}
          noWrap
          sx={{ flexShrink: 1, minWidth: 0, maxWidth: { xs: '38%', sm: '32%', md: '28%' }, fontSize: '0.9375rem' }}
        >
          {title}
        </Typography>

        <ContactNameEditor
          displayName={conversation.displayName}
          saving={savingContact}
          error={contactError}
          onSave={onUpdateContact}
        />

        <ConversationStatusBadge status={conversation.status} />

        <Tooltip title={headerMeta}>
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{
              flex: 1,
              minWidth: 0,
              display: { xs: 'none', md: 'block' },
              fontSize: '0.8125rem',
            }}
          >
            {headerMeta}
          </Typography>
        </Tooltip>

        {headerActions}
      </Stack>

      {contactError && (
        <Typography variant="caption" color="error.main" sx={{ px: onBack ? 0.5 : 0 }}>
          {contactError}
        </Typography>
      )}
    </Stack>
  );

  const overflowMenu = (
    <Menu
      anchorEl={menuAnchor}
      open={Boolean(menuAnchor)}
      onClose={() => setMenuAnchor(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      {showClaimInHeader && (
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            void onClaim();
          }}
          disabled={claiming}
        >
          Tomar conversación
        </MenuItem>
      )}
      {conversation.displayName?.trim() && conversation.phoneNumber && (
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <ListItemText primary={conversation.phoneNumber} primaryTypographyProps={{ variant: 'body2' }} />
        </MenuItem>
      )}
      {conversation.contactEmail?.trim() && (
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <ListItemText
            primary={`Email: ${conversation.contactEmail.trim()}`}
            primaryTypographyProps={{ variant: 'body2' }}
          />
        </MenuItem>
      )}
      {motivo && (
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <ListItemText
            primary={`Motivo: ${motivo}`}
            primaryTypographyProps={{ variant: 'body2' }}
          />
        </MenuItem>
      )}
      <MenuItem disabled sx={{ opacity: '1 !important', display: { md: 'none' } }}>
        <ListItemText primary={headerMeta} primaryTypographyProps={{ variant: 'body2' }} />
      </MenuItem>
    </Menu>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          flexShrink: 0,
          overflow: 'hidden',
          px: { xs: 1, md: 1.5 },
          py: 0,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        {detailHeader}
        {overflowMenu}
      </Box>

      <ConversationMessageTimeline
        key={conversationId ?? conversation.id}
        messages={messages}
        loading={loadingMessages}
        error={messagesError}
        conversationId={conversationId ?? conversation.id}
        readAt={readAt}
        onCaughtUp={onCaughtUp}
      />

      <Box
        sx={{
          flexShrink: 0,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <ConversationComposer
          status={conversation.status}
          sending={sending}
          claiming={claiming}
          actionError={actionError}
          successMessage={successMessage}
          compact={isCompactDetail}
          onSend={onSend}
          onClaim={onClaim}
        />
      </Box>
    </Box>
  );
};
