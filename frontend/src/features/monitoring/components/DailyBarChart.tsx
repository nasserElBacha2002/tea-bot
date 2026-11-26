import { useMemo } from 'react';
import { Box, Typography } from '@mui/material';

export interface DailyBarPoint {
  label: string;
  inbound?: number;
  outbound?: number;
  value?: number;
}

interface DailyBarChartProps {
  title: string;
  points: DailyBarPoint[];
  showDual?: boolean;
  height?: number;
}

export function DailyBarChart({ title, points, showDual = false, height = 140 }: DailyBarChartProps) {
  const max = useMemo(() => {
    let peak = 1;
    for (const point of points) {
      if (showDual) {
        peak = Math.max(peak, point.inbound ?? 0, point.outbound ?? 0);
      } else {
        peak = Math.max(peak, point.value ?? 0);
      }
    }
    return peak;
  }, [points, showDual]);

  if (points.length === 0) {
    return (
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary">Sin datos para el período.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{title}</Typography>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 0.5,
          height,
          overflowX: 'auto',
          pb: 0.5,
        }}
        aria-label={title}
      >
        {points.map((point) => {
          const inboundHeight = ((point.inbound ?? 0) / max) * 100;
          const outboundHeight = ((point.outbound ?? 0) / max) * 100;
          const singleHeight = ((point.value ?? 0) / max) * 100;
          return (
            <Box
              key={point.label}
              sx={{ minWidth: 22, flex: '1 0 22px', textAlign: 'center' }}
              title={`${point.label}${showDual ? `: in ${point.inbound ?? 0} / out ${point.outbound ?? 0}` : `: ${point.value ?? 0}`}`}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 0.25, height: height - 24 }}>
                {showDual ? (
                  <>
                    <Box sx={{ width: '40%', bgcolor: 'info.main', height: `${inboundHeight}%`, borderRadius: 0.5 }} />
                    <Box sx={{ width: '40%', bgcolor: 'success.main', height: `${outboundHeight}%`, borderRadius: 0.5 }} />
                  </>
                ) : (
                  <Box sx={{ width: '70%', bgcolor: 'primary.main', height: `${singleHeight}%`, borderRadius: 0.5 }} />
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                {point.label.slice(5)}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}