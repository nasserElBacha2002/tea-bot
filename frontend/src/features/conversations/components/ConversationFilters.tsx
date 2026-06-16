import React from 'react';
import {
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Stack,
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

export const ConversationFilters: React.FC<Props> = ({
  filters,
  onChange,
  onRefresh,
  refreshing,
}) => {
  const channelValue = resolveChannelFilterValue(filters.channel);

  return (
    <Stack
      spacing={1.5}
      sx={{
        flexShrink: 0,
        p: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <TextField
        size="small"
        fullWidth
        label="Buscar por teléfono o nombre"
        value={filters.search ?? ''}
        onChange={(e) => onChange({ search: e.target.value })}
      />
      <Stack direction="row" spacing={1}>
        <FormControl size="small" fullWidth>
          <InputLabel id="conv-status-filter">Estado</InputLabel>
          <Select
            labelId="conv-status-filter"
            label="Estado"
            value={filters.status ?? ''}
            onChange={(e) =>
              onChange({ status: e.target.value as ConversationStatus | '' })
            }
          >
            {STATUS_OPTIONS.map((opt) => (
              <MenuItem key={opt.value || 'all'} value={opt.value}>
                {opt.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" fullWidth>
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
          >
            <MenuItem value={CHANNEL_FILTER_ALL}>{CHANNEL_FILTER_LABELS.all}</MenuItem>
            <MenuItem value="whatsapp">{CHANNEL_FILTER_LABELS.whatsapp}</MenuItem>
            <MenuItem value="simulator">{CHANNEL_FILTER_LABELS.simulator}</MenuItem>
          </Select>
        </FormControl>
      </Stack>
      <Button
        variant="outlined"
        size="small"
        startIcon={<Refresh />}
        onClick={onRefresh}
        disabled={refreshing}
      >
        Actualizar
      </Button>
    </Stack>
  );
};
