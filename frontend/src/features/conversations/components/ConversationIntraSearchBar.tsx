import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
  Alert,
  Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import SearchIcon from '@mui/icons-material/Search';
import { conversationsApi } from '../api/conversationsApi';
import type { ConversationSearchMessageHit } from '../types/conversation.types';
import { extractApiError } from '../../../utils/apiError';

const DEBOUNCE_MS = 300;

interface Props {
  conversationId: string;
  open: boolean;
  onClose: () => void;
  onFocusHit: (hit: ConversationSearchMessageHit, index: number) => void;
  onSearchTermChange?: (term: string) => void;
}

export const ConversationIntraSearchBar: React.FC<Props> = ({
  conversationId,
  open,
  onClose,
  onFocusHit,
  onSearchTermChange,
}) => {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [hits, setHits] = useState<ConversationSearchMessageHit[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const cancelSearch = useCallback(() => {
    searchRequestIdRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    cancelSearch();
    if (term.trim().length < 2) {
      setHits([]);
      setNextCursor(null);
      setIndex(0);
      setSearchError(null);
      setLoading(false);
    }
    const timer = setTimeout(() => setDebounced(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, cancelSearch]);

  useEffect(() => {
    onSearchTermChange?.(debounced);
  }, [debounced, onSearchTermChange]);

  useEffect(() => {
    cancelSearch();
    if (!open) {
      setTerm('');
      setDebounced('');
      setHits([]);
      setNextCursor(null);
      setIndex(0);
      setSearchError(null);
      setLoading(false);
    }
  }, [open, conversationId, cancelSearch]);

  useEffect(() => () => cancelSearch(), [cancelSearch]);

  const runSearch = useCallback(
    async (q: string, cursor: string | null, append: boolean) => {
      if (!open || q.length < 2) return null;
      const requestId = searchRequestIdRef.current + 1;
      searchRequestIdRef.current = requestId;
      const convId = conversationIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setSearchError(null);
      try {
        const data = await conversationsApi.searchMessagesInConversation(
          convId,
          { q, cursor },
          { signal: controller.signal },
        );
        if (searchRequestIdRef.current !== requestId) return null;
        if (!open || conversationIdRef.current !== convId) return null;
        setHits((prev) => (append ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor);
        if (!append) setIndex(0);
        return data;
      } catch (error) {
        if (controller.signal.aborted) return null;
        if (searchRequestIdRef.current !== requestId) return null;
        const info = extractApiError(error);
        setSearchError(info.message || 'No se pudo buscar en el chat');
        if (!append) setHits([]);
        return null;
      } finally {
        if (searchRequestIdRef.current === requestId && !controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [open],
  );

  useEffect(() => {
    cancelSearch();
    if (!open || debounced.length < 2) {
      setHits([]);
      setNextCursor(null);
      setIndex(0);
      setSearchError(null);
      setLoading(false);
      return;
    }
    void runSearch(debounced, null, false);
  }, [debounced, open, runSearch, cancelSearch]);

  const focusHitRef = useRef(onFocusHit);
  focusHitRef.current = onFocusHit;

  useEffect(() => {
    const hit = hits[index];
    if (hit && debounced.length >= 2) focusHitRef.current(hit, index);
  }, [hits, index, debounced]);

  const positionLabel = useMemo(() => {
    if (hits.length === 0) return '0';
    if (nextCursor) return `${index + 1}+`;
    return `${index + 1}/${hits.length}`;
  }, [hits.length, index, nextCursor]);

  const goNext = useCallback(async () => {
    if (index + 1 < hits.length) {
      setIndex(index + 1);
      return;
    }
    if (!nextCursor || loading) return;
    const beforeLen = hits.length;
    const data = await runSearch(debounced, nextCursor, true);
    if (!data || data.items.length === 0) return;
    setIndex(beforeLen);
  }, [index, hits.length, nextCursor, loading, runSearch, debounced]);

  if (!open) return null;

  return (
    <Box
      data-testid="conversation-intra-search"
      sx={{ px: 1, py: 0.5, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
    >
      {searchError && (
        <Alert
          severity="error"
          sx={{ mb: 0.5, py: 0 }}
          action={(
            <Button color="inherit" size="small" onClick={() => void runSearch(debounced, null, false)}>
              Reintentar
            </Button>
          )}
        >
          {searchError}
        </Alert>
      )}
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <TextField
          size="small"
          placeholder="Buscar en el chat"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          autoFocus
          sx={{ flex: 1, minWidth: 0 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: loading ? (
              <InputAdornment position="end">
                <CircularProgress size={16} />
              </InputAdornment>
            ) : undefined,
          }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ minWidth: 44, textAlign: 'center' }}>
          {positionLabel}
        </Typography>
        <IconButton
          size="small"
          aria-label="Resultado anterior"
          disabled={index <= 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <NavigateBeforeIcon fontSize="small" />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Resultado siguiente"
          disabled={hits.length === 0 || (index >= hits.length - 1 && !nextCursor)}
          onClick={() => void goNext()}
        >
          <NavigateNextIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" aria-label="Cerrar búsqueda" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );
};