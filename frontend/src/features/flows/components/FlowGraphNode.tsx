import React, { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Box, Chip, Typography, Tooltip } from '@mui/material';
import { RadioButtonChecked } from '@mui/icons-material';
import type { FlowNode } from '../types/flow.types';
import type { NodeIssue } from '../utils/flowGraph.validation';
import { NODE_TYPE_BG, NODE_TYPE_COLORS } from '../utils/flowGraph.mapper';
import { UI_NODE_TYPE } from '../utils/flowUiLabels';
import type { MapViewStyle, MessagePreview, TransitionGroup } from '../utils/flowMapDisplay';
import { formatTransitionSummary } from '../utils/flowMapDisplay';

interface FlowGraphNodeData {
  node: FlowNode;
  isEntry: boolean;
  isFallback: boolean;
  issues?: NodeIssue[];
  simActive?: boolean;
  mapDisplayMode?: boolean;
  mapViewStyle?: MapViewStyle;
  mapFocus?: boolean;
  displayTitle?: string;
  transitionCount?: number;
  messagePreview?: MessagePreview;
  transitionGroups?: TransitionGroup[];
  footerHints?: string[];
}

interface FlowGraphNodeProps {
  data: FlowGraphNodeData;
  selected: boolean;
}

const MAP_CARD_WIDTH = 300;
const MAP_CARD_MAX_HEIGHT = 220;

export const FlowGraphNode: React.FC<FlowGraphNodeProps> = memo(({ data, selected }) => {
  const {
    node,
    isEntry,
    isFallback,
    issues = [],
    simActive,
    mapDisplayMode = false,
    mapViewStyle = 'message',
    mapFocus = false,
    displayTitle,
    messagePreview,
    transitionGroups = [],
    footerHints = [],
  } = data;

  const isMapMessageView = mapDisplayMode && mapViewStyle === 'message';
  const isMapTechnicalView = mapDisplayMode && mapViewStyle === 'technical';

  const color = NODE_TYPE_COLORS[node.type] ?? '#64748b';
  const bg = NODE_TYPE_BG[node.type] ?? '#f8fafc';

  const hasError = issues.some((i) => i.severity === 'error');
  const hasWarn = issues.some((i) => i.severity === 'warning');

  const borderColor = mapFocus
    ? '#ea580c'
    : selected
      ? color
      : hasError
        ? '#dc2626'
        : hasWarn
          ? '#d97706'
          : isMapMessageView
            ? '#cbd5e1'
            : color;
  const borderWidth = mapFocus ? 2.5 : selected ? 2 : hasError || hasWarn ? 2 : 1.5;

  const issueTitle = issues.map((i) => `• ${i.message}`).join('\n');
  const fullMessageTooltip = messagePreview?.full ?? node.message ?? '';

  if (isMapMessageView) {
    return (
      <Tooltip title={fullMessageTooltip} placement="top" enterDelay={400}>
        <Box
          sx={{
            width: MAP_CARD_WIDTH,
            maxHeight: MAP_CARD_MAX_HEIGHT,
            background: '#fff',
            border: `${borderWidth}px solid ${borderColor}`,
            borderRadius: 1.5,
            boxShadow: mapFocus
              ? '0 0 0 3px rgba(234,88,12,0.25), 0 4px 12px rgba(15,23,42,0.1)'
              : '0 2px 8px rgba(15,23,42,0.06)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
          }}
        >
          <Box sx={{ px: 1.25, pt: 1, pb: 0.5, flexShrink: 0 }}>
            <Typography
              variant="caption"
              fontWeight={700}
              color="text.secondary"
              sx={{ lineHeight: 1.2, display: 'block' }}
              noWrap
            >
              {displayTitle ?? node.id}
            </Typography>
          </Box>

          <Box
            sx={{
              px: 1.25,
              flex: 1,
              minHeight: 0,
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {(messagePreview?.lines ?? []).map((line, i) => (
              <Typography
                key={i}
                variant="body2"
                sx={{
                  fontSize: 13,
                  lineHeight: 1.4,
                  color: 'text.primary',
                  fontWeight: i === 0 ? 600 : 400,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {line}
              </Typography>
            ))}
            {messagePreview?.truncated && (
              <Typography variant="caption" color="text.disabled">
                …
              </Typography>
            )}
          </Box>

          {transitionGroups.length > 0 && (
            <Box sx={{ px: 1.25, py: 0.5, flexShrink: 0 }}>
              {transitionGroups.slice(0, 4).map((g) => (
                <Tooltip
                  key={g.target}
                  title={g.preview ? `Respuestas: ${g.preview}` : g.target}
                  placement="bottom"
                >
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    noWrap
                    sx={{ fontSize: 11, lineHeight: 1.35 }}
                  >
                    {formatTransitionSummary(g, 'card')}
                  </Typography>
                </Tooltip>
              ))}
            </Box>
          )}

          <Box
            sx={{
              px: 1.25,
              py: 0.6,
              mt: 'auto',
              borderTop: '1px solid',
              borderColor: 'divider',
              display: 'flex',
              gap: 0.5,
              flexWrap: 'wrap',
              flexShrink: 0,
              bgcolor: '#f8fafc',
            }}
          >
            {isEntry && (
              <Typography variant="caption" sx={{ fontSize: 10, color: 'success.dark', fontWeight: 600 }}>
                Entrada
              </Typography>
            )}
            {footerHints.map((hint) => (
              <Typography
                key={hint}
                variant="caption"
                sx={{
                  fontSize: 10,
                  color: hint.includes('revisión') ? 'error.main' : 'text.secondary',
                  fontWeight: hint.includes('revisión') ? 700 : 500,
                }}
              >
                {hint}
              </Typography>
            ))}
          </Box>

          <Handle
            type="target"
            position={Position.Top}
            style={{ background: '#94a3b8', width: 8, height: 8, border: '2px solid #fff' }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            style={{ background: '#94a3b8', width: 8, height: 8, border: '2px solid #fff' }}
          />
        </Box>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={issues.length ? issueTitle : ''} disableHoverListener={!issues.length}>
      <Box
        sx={{
          background: bg,
          border: `${borderWidth}px solid ${borderColor}`,
          borderLeft: hasError ? `5px solid` : hasWarn ? `5px solid` : undefined,
          borderLeftColor: hasError ? 'error.main' : hasWarn ? 'warning.main' : undefined,
          borderRadius: 2,
          minWidth: isMapTechnicalView ? 260 : 210,
          maxWidth: isMapTechnicalView ? 320 : 280,
          maxHeight: isMapTechnicalView ? MAP_CARD_MAX_HEIGHT : undefined,
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

        {!isMapTechnicalView && (
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
        )}

        {isMapTechnicalView && (
          <Box sx={{ px: 1.25, py: 0.75, bgcolor: `${color}14`, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="caption" fontWeight={700} display="block">
              {UI_NODE_TYPE[node.type] ?? node.type}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 10 }}>
              {node.id}
            </Typography>
          </Box>
        )}

        <Box sx={{ px: 1.5, py: 1.1, overflow: isMapTechnicalView ? 'auto' : undefined, maxHeight: isMapTechnicalView ? 140 : undefined }}>
          <Typography variant="body2" fontWeight={800} color="text.primary" sx={{ letterSpacing: 0.2 }}>
            {displayTitle ?? node.id}
          </Typography>
          {isMapTechnicalView && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
              {node.transitions?.length ?? 0} transiciones
            </Typography>
          )}
          {node.message && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: '-webkit-box',
                WebkitLineClamp: isMapTechnicalView ? 3 : 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                mt: 0.35,
                lineHeight: 1.35,
                whiteSpace: 'pre-wrap',
              }}
              title={node.message}
            >
              {isMapTechnicalView && node.message.length > 120
                ? `${node.message.slice(0, 119)}…`
                : node.message}
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
          {isMapTechnicalView &&
            (node.transitions ?? []).slice(0, 5).map((t, i) => (
              <Typography key={i} variant="caption" display="block" sx={{ fontFamily: 'monospace', fontSize: 10 }}>
                {t.type ?? '?'} → {t.nextNode}
              </Typography>
            ))}
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
