import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Flow } from '../../types/flow.types';
import { simulatorApi } from '../../api/simulatorApi';
import type { ConversationViewModel } from '../model/conversationViewModel';

export type SimulatorChatMessage = { role: 'bot' | 'user'; text: string };

/** Firma estable del borrador para detectar cambios sin reiniciar la simulación. */
export function stableDraftSignature(flow: Flow): string {
  try {
    return JSON.stringify({
      id: flow.id,
      name: flow.name,
      entryNode: flow.entryNode,
      fallbackNode: flow.fallbackNode,
      nodes: flow.nodes,
    });
  } catch {
    return String(flow.id);
  }
}

export interface UseConversationSimulatorParams {
  flowId: string;
  draftFlow: Flow;
  viewModel: ConversationViewModel;
}

export function useConversationSimulator({ flowId, draftFlow, viewModel }: UseConversationSimulatorParams) {
  const sessionIdRef = useRef(`sim-${flowId}-${Date.now()}`);
  const draftFlowRef = useRef(draftFlow);
  draftFlowRef.current = draftFlow;

  useEffect(() => {
    sessionIdRef.current = `sim-${flowId}-${Date.now()}`;
  }, [flowId]);

  const [messages, setMessages] = useState<SimulatorChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [baselineSignature, setBaselineSignature] = useState('');

  const draftSignature = useMemo(() => stableDraftSignature(draftFlow), [draftFlow]);
  const draftOutOfSync = Boolean(started && baselineSignature && draftSignature !== baselineSignature);

  const currentStepTitle = useMemo(() => {
    if (!currentNodeId) return '';
    const step = viewModel.steps.find(s => s.internalId === currentNodeId);
    return step?.title ?? '';
  }, [currentNodeId, viewModel.steps]);

  const applyStartResponse = useCallback((flow: Flow, res: Awaited<ReturnType<typeof simulatorApi.start>>) => {
    const reply = res.reply ?? '';
    setMessages(reply ? [{ role: 'bot' as const, text: reply }] : []);
    setCurrentNodeId(res.currentNodeId ?? null);
    setVariables(res.variables ?? {});
    setStarted(true);
    setBaselineSignature(stableDraftSignature(flow));
  }, []);

  const bootstrap = useCallback(
    async (opts?: { signal?: { cancelled: boolean } }) => {
      setError(null);
      setLoading(true);
      try {
        const flow = draftFlowRef.current;
        const res = await simulatorApi.start({
          flowId,
          sessionId: sessionIdRef.current,
          flow,
        });
        if (opts?.signal?.cancelled) return;
        applyStartResponse(flow, res);
      } catch {
        if (opts?.signal?.cancelled) return;
        setError('No se pudo probar la conversación. Intenta nuevamente.');
        setStarted(false);
        setMessages([]);
        setCurrentNodeId(null);
        setVariables({});
      } finally {
        if (!opts?.signal?.cancelled) setLoading(false);
      }
    },
    [flowId, applyStartResponse]
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void bootstrap({ signal });
    return () => {
      signal.cancelled = true;
    };
  }, [flowId, bootstrap]);

  const sendMessage = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || !started || sending) return;
      setSending(true);
      setError(null);
      setMessages(m => [...m, { role: 'user', text: t }]);
      try {
        const res = await simulatorApi.message({ sessionId: sessionIdRef.current, text: t });
        setMessages(m => [...m, { role: 'bot', text: res.reply ?? '' }]);
        setCurrentNodeId(res.currentNodeId ?? null);
        setVariables(res.variables ?? {});
      } catch {
        setError('No se pudo enviar el mensaje. Intenta nuevamente.');
      } finally {
        setSending(false);
      }
    },
    [started, sending]
  );

  const restart = useCallback(async () => {
    setError(null);
    setSending(true);
    try {
      await simulatorApi.reset(sessionIdRef.current);
      const flow = draftFlowRef.current;
      const res = await simulatorApi.start({
        flowId,
        sessionId: sessionIdRef.current,
        flow,
      });
      applyStartResponse(flow, res);
    } catch {
      setError('No se pudo probar la conversación. Intenta nuevamente.');
      setStarted(false);
      setMessages([]);
    } finally {
      setSending(false);
    }
  }, [flowId, applyStartResponse]);

  const retry = useCallback(() => {
    void bootstrap();
  }, [bootstrap]);

  return {
    messages,
    loading,
    sending,
    error,
    started,
    sendMessage,
    restart,
    retry,
    currentStepTitle,
    variables,
    draftOutOfSync,
  };
}
