import React from 'react';
import { Box, Typography } from '@mui/material';

export const EmptyResponsesState: React.FC = () => (
  <Box
    sx={{
      py: 2,
      px: 1.5,
      borderRadius: 2,
      border: '1px dashed',
      borderColor: 'divider',
      bgcolor: 'action.hover',
    }}
  >
    <Typography variant="body2" color="text.secondary">
      Aún no definiste qué puede responder el cliente.
    </Typography>
  </Box>
);
