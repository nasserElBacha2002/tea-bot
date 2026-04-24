import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Box, Chip, Typography, Tooltip } from '@mui/material';
import { RadioButtonChecked } from '@mui/icons-material';
import type { FlowNode } from '../types/flow.types';
import type { NodeIssue } from '../utils/flowGraph.validation';
import { NODE_TYPE_BG, NODE_TYPE_COLORS } from '../utils/flowGraph.mapper';
import { UI_NODE_TYPE } from '../utils/flowUiLabels';

interface FlowGraphNodeData {
  node: FlowNode;
  isEntry: boolean;
  isFallback: boolean;
  issues?: NodeIssue[];
  simActive?: boolean;
}

interface FlowGraphNodeProps {
  data: FlowGraphNodeData;
  selected: boolean;
}

export const FlowGraphNode: React.FC<FlowGraphNodeProps> = memo(({ data, selected }) => {
  const { node, isEntry, isFallback, issues = [], simActive } = data;
  const color = NODE_TYPE_COLORS[node.type] ?? '#64748b';
  const bg = NODE_TYPE_BG[node.type] ?? '#f8fafc';

  const hasError = issues.some(i => i.severity === 'error');
  const hasWarn = issues.some(i => i.severity === 'warning');

  const borderColor = selected ? color : hasError ? '#dc2626' : hasWarn ? '#d97706' : color;
  const borderWidth = selected ? 2.5 : hasError || hasWarn ? 2 : 1.5;

  const issueTitle = issues.map(i => `• ${i.message}`).join('\n');

  return (
    <Tooltip title={issues.length ? issueTitle : ''} disableHoverListener={!issues.length}>
      <Box
        sx={{
          background: bg,
          border: `${borderWidth}px solid ${borderColor}`,
          borderLeft: hasError ? `5px solid` : hasWarn ? `5px solid` : undefined,
          borderLeftColor: hasError ? 'error.main' : hasWarn ? 'warning.main' : undefined,
          borderRadius: 2,
          minWidth: 210,
          maxWidth: 280,
          boxShadow: selected
            ? `0 0 0 4px ${color}40`
            : simActive
              ? `0 0 0 3px #0ea5e9, 0 4px 14px rgba(14,165,233,0.35)`
              : '0 2px 10px rgba(15,23,42,0.08)',
          transition: 'box-shadow 0.18s ease, border-color 0.18s ease',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {simActive && (
          <Box
            sx={{
              position: 'absolute',
              top: 4,
              right: 4,
              color: '#0284c7',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Box component="span" title="Simulador en este nodo" sx={{ display: 'inline-flex', lineHeight: 0 }}>
              <RadioButtonChecked sx={{ fontSize: 18 }} />
            </Box>
          </Box>
        )}

        <Box
          sx={{
            background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
            px: 1.5,
            py: 0.65,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            flexWrap: 'wrap',
          }}
        >
        <Chip
          label={UI_NODE_TYPE[node.type] ?? node.type}
          size="small"
          sx={{
            backgroundColor: 'rgba(255,255,255,0.22)',
            color: '#fff',
            fontWeight: 800,
            fontSize: 10,
            height: 20,
            letterSpacing: 0.3,
          }}
        />
        {isEntry && (
          <Chip
            label="ENTRADA"
            size="small"
            sx={{
              bgcolor: '#15803d',
              color: '#fff',
              fontWeight: 800,
              fontSize: 9,
              height: 20,
            }}
          />
        )}
        {isFallback && (
          <Chip
            label="RESPALDO"
            size="small"
            sx={{
              bgcolor: '#b91c1c',
              color: '#fff',
              fontWeight: 800,
              fontSize: 9,
              height: 20,
            }}
          />
        )}
      </Box>

        <Box sx={{ px: 1.5, py: 1.1 }}>
        <Typography variant="body2" fontWeight={800} color="text.primary" sx={{ letterSpacing: 0.2 }}>
          {node.id}
        </Typography>
        {node.message && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              mt: 0.35,
              lineHeight: 1.35,
            }}
          >
            {node.message}
          </Typography>
        )}
        {node.type === 'capture' && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
            Variable: <strong>{node.variableName || '—'}</strong>
          </Typography>
        )}
        {node.type === 'redirect' && node.nextNode && (
          <Typography variant="caption" color="text.secondary">
            → {node.nextNode}
          </Typography>
        )}
        {(!node.transitions || node.transitions.length === 0) &&
          node.type !== 'end' &&
          !node.nextNode && (
            <Typography variant="caption" sx={{ color: 'warning.dark', fontWeight: 700, mt: 0.5, display: 'block' }}>
              Sin salida
            </Typography>
          )}
      </Box>

        <Handle
          type="target"
          position={Position.Top}
          style={{
            background: color,
            width: 11,
            height: 11,
            border: '2px solid #fff',
          }}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          style={{
            background: color,
            width: 11,
            height: 11,
            border: '2px solid #fff',
          }}
        />
      </Box>
    </Tooltip>
  );
});

FlowGraphNode.displayName = 'FlowGraphNode';
