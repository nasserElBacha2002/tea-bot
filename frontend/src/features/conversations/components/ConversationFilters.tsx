import React from 'react';
import {
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Stack,
  IconButton,
  Tooltip,
  Box,
} from '@mui/material';
import { Refresh } from '@mui/icons-material';
import type {
  ConversationChannel,
  ConversationListFilters,
  ConversationStatus,
} from '../types/conversation.types';
import {
  CHANNEL_FILTER_ALL,
  CHANNEL_FILTER_LABELS,
  channelFilterLabel,
  resolveChannelFilterValue,
} from '../constants/conversationChannels';
import { CONVERSATION_STATUS_LABELS } from '../utils/conversationUiLabels';
import { conversationUiDensity } from '../constants/conversationUiDensity';

interface Props {
  filters: ConversationListFilters;
  onChange: (patch: Partial<ConversationListFilters>) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}

const STATUS_OPTIONS: Array<{ value: ConversationStatus | ''; label: string }> = [
  { value: '', label: CONVERSATION_STATUS_LABELS.all },
  { value: 'bot', label: CONVERSATION_STATUS_LABELS.bot },
  { value: 'waiting_human', label: CONVERSATION_STATUS_LABELS.waiting_human },
  { value: 'assigned', label: CONVERSATION_STATUS_LABELS.assigned },
  { value: 'closed', label: CONVERSATION_STATUS_LABELS.closed },
  { value: 'paused', label: CONVERSATION_STATUS_LABELS.paused },
];

const compactControlSx = {
  '& .MuiInputBase-root': {
    minHeight: conversationUiDensity.controlHeight,
    fontSize: '0.8125rem',
  },
  '& .MuiInputLabel-root': { fontSize: '0.8125rem' },
};

export const ConversationFilters: React.FC<Props> = ({
  filters,
  onChange,
  onRefresh,
  refreshing,
}) => {
  const channelValue = resolveChannelFilterValue(filters.channel);

  return (
    <Box
      data-testid="conversation-filters"
      sx={{
        flexShrink: 0,
        px: conversationUiDensity.filterPadding,
        py: 0.75,
        borderBottom: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
      }}
    >
      <TextField
        size="small"
        label="Buscar"
        placeholder="Teléfono o nombre"
        value={filters.search ?? ''}
        onChange={(e) => onChange({ search: e.target.value })}
        sx={{ width: '100%', ...compactControlSx }}
        data-testid="conversation-search-input"
      />

      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ width: '100%' }}>
        <FormControl size="small" sx={{ flex: 1, minWidth: 0, ...compactControlSx }}>
          <InputLabel id="conv-status-filter">Estado</InputLabel>
          <Select
            labelId="conv-status-filter"
            label="Estado"
            value={filters.status ?? ''}
            onChange={(e) =>
              onChange({ status: e.target.value as ConversationStatus | '' })
            }
            data-testid="conversation-status-filter"
          >
            {STATUS_OPTIONS.map((opt) => (
              <MenuItem key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ flex: 1, minWidth: 0, ...compactControlSx }}>
          <InputLabel id="conv-channel-filter" shrink>
            Canal
          </InputLabel>
          <Select
            labelId="conv-channel-filter"
            label="Canal"
            value={channelValue}
            displayEmpty
            renderValue={(selected) =>
              channelFilterLabel(selected as ConversationChannel | typeof CHANNEL_FILTER_ALL)
            }
            onChange={(e) =>
              onChange({
                channel: e.target.value as ConversationListFilters['channel'],
              })
            }
            data-testid="conversation-channel-filter"
          >
            <MenuItem value={CHANNEL_FILTER_ALL}>{CHANNEL_FILTER_LABELS.all}</MenuItem>
            <MenuItem value="whatsapp">{CHANNEL_FILTER_LABELS.whatsapp}</MenuItem>
            <MenuItem value="simulator">{CHANNEL_FILTER_LABELS.simulator}</MenuItem>
          </Select>
        </FormControl>

        <Tooltip title="Actualizar">
          <span>
            <IconButton
              size="small"
              aria-label="Actualizar conversaciones"
              onClick={onRefresh}
              disabled={refreshing}
              data-testid="conversation-refresh-button"
              sx={{
                width: conversationUiDensity.controlHeight,
                height: conversationUiDensity.controlHeight,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                flexShrink: 0,
              }}
            >
              <Refresh fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
};
