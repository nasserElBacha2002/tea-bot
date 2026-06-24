const BEEP_FREQUENCY_HZ = 880;
const BEEP_DURATION_S = 0.28;
const BEEP_VOLUME = 0.22;

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioContext) audioContext = new Ctx();
  return audioContext;
}

export async function unlockConversationAlertSound(): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }
  return ctx.state === 'running';
}

export function isConversationAlertSoundBlocked(): boolean {
  const ctx = getAudioContext();
  if (!ctx) return true;
  return ctx.state !== 'running';
}

export async function playConversationAlertSound(): Promise<'played' | 'blocked' | 'unsupported'> {
  const ctx = getAudioContext();
  if (!ctx) return 'unsupported';
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return 'blocked';
    }
  }
  if (ctx.state !== 'running') return 'blocked';

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = BEEP_FREQUENCY_HZ;
  gain.gain.setValueAtTime(BEEP_VOLUME, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + BEEP_DURATION_S);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + BEEP_DURATION_S);
  return 'played';
}

/** @internal test helper */
export function resetConversationAlertSoundForTests(): void {
  if (audioContext) {
    void audioContext.close();
    audioContext = null;
  }
}
