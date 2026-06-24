import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationLiveEvent } from '../types/conversationLive.types';
import {
  getConversationAlertsEnabled,
  setConversationAlertsEnabled,
} from '../utils/conversationAlertPreferences';
import {
  isConversationAlertSoundBlocked,
  playConversationAlertSound,
  unlockConversationAlertSound,
} from '../utils/conversationAlertSound';
import {
  buildConversationAlertEventId,
  shouldPlayConversationAlert,
  type ConversationAlertUserContext,
} from '../utils/shouldPlayConversationAlert';

export const CONVERSATION_ALERT_THROTTLE_MS = 3_000;

export interface ConversationAlertToast {
  id: string;
  message: string;
}

export interface UseConversationAlertsOptions {
  enabled: boolean;
  userContext: ConversationAlertUserContext;
}

export function useConversationAlerts({ enabled, userContext }: UseConversationAlertsOptions) {
  const [soundEnabled, setSoundEnabledState] = useState(() => getConversationAlertsEnabled());
  const [soundBlocked, setSoundBlocked] = useState(() => isConversationAlertSoundBlocked());
  const [pendingToast, setPendingToast] = useState<ConversationAlertToast | null>(null);

  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const lastPlayedAtRef = useRef(0);
  const playingRef = useRef(false);

  const setSoundEnabled = useCallback((next: boolean) => {
    setSoundEnabledState(next);
    setConversationAlertsEnabled(next);
  }, []);

  const unlockSound = useCallback(async () => {
    const ok = await unlockConversationAlertSound();
    setSoundBlocked(!ok);
    if (ok && soundEnabled) {
      await playConversationAlertSound();
    }
    return ok;
  }, [soundEnabled]);

  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = () => {
      void unlockConversationAlertSound().then((ok) => setSoundBlocked(!ok));
    };
    window.addEventListener('pointerdown', onPointerDown, { once: true, passive: true });
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [enabled]);

  const dismissToast = useCallback(() => {
    setPendingToast(null);
  }, []);

  const processEvent = useCallback(
    async (event: ConversationLiveEvent) => {
      if (!enabled || !soundEnabled) return;
      if (!shouldPlayConversationAlert(event, userContext)) return;

      const eventId = buildConversationAlertEventId(event);
      if (!eventId) return;
      if (seenEventIdsRef.current.has(eventId)) return;

      const now = Date.now();
      if (playingRef.current || now - lastPlayedAtRef.current < CONVERSATION_ALERT_THROTTLE_MS) {
        return;
      }

      seenEventIdsRef.current.add(eventId);
      if (seenEventIdsRef.current.size > 500) {
        const keep = Array.from(seenEventIdsRef.current).slice(-250);
        seenEventIdsRef.current = new Set(keep);
      }

      playingRef.current = true;
      lastPlayedAtRef.current = now;
      try {
        const result = await playConversationAlertSound();
        if (result === 'blocked') {
          setSoundBlocked(true);
          setPendingToast({
            id: eventId,
            message: 'Nuevo mensaje pendiente de atención. Hacé clic para activar el sonido.',
          });
        } else if (result === 'unsupported') {
          setPendingToast({
            id: eventId,
            message: 'Nuevo mensaje pendiente de atención.',
          });
        }
      } finally {
        playingRef.current = false;
      }
    },
    [enabled, soundEnabled, userContext],
  );

  return {
    soundEnabled,
    setSoundEnabled,
    soundBlocked,
    unlockSound,
    pendingToast,
    dismissToast,
    processEvent,
  };
}
