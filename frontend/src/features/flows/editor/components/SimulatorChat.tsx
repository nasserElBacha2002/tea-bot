import React from 'react';
import { Box } from '@mui/material';
import type { SimulatorChatMessage } from '../state/useConversationSimulator';
import { SimulatorMessageList } from './SimulatorMessageList';
import { SimulatorComposer } from './SimulatorComposer';

export interface SimulatorChatProps {
  messages: SimulatorChatMessage[];
  loading?: boolean;
  started: boolean;
  sending: boolean;
  composerDisabled?: boolean;
  onSend: (text: string) => void;
  showEmptyHint?: boolean;
}

export const SimulatorChat: React.FC<SimulatorChatProps> = ({
  messages,
  loading,
  started,
  sending,
  composerDisabled,
  onSend,
  showEmptyHint,
}) => {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <SimulatorMessageList messages={messages} showEmptyHint={showEmptyHint} />
      <SimulatorComposer
        disabled={composerDisabled || loading || !started}
        sending={sending}
        onSend={onSend}
      />
    </Box>
  );
};
