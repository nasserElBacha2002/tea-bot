import type {
  ConversationMessage,
  OutboundDispatchState,
  WhatsappDeliveryStatus,
} from '../types/conversation.types';

export type OutboundDeliveryVisual =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'uncertain'
  | 'none';

export interface OutboundDeliveryUi {
  visual: OutboundDeliveryVisual;
  errorMessage?: string | null;
}

const FAILURE_WA: WhatsappDeliveryStatus[] = ['failed', 'undelivered'];

function operatorFacingError(
  whatsappErrorMessage?: string | null,
  whatsappErrorCode?: string | null,
  dispatchError?: string | null,
): string | null {
  const waMsg = whatsappErrorMessage?.trim();
  if (waMsg) return waMsg;
  if (whatsappErrorCode) return `Error Twilio ${whatsappErrorCode}`;
  const dispatchMsg = dispatchError?.trim();
  if (dispatchMsg) return dispatchMsg;
  return null;
}

export function resolveOutboundDeliveryUi(message: ConversationMessage): OutboundDeliveryUi {
  if (message.direction !== 'outbound') return { visual: 'none' };
  if (message.senderType === 'system') return { visual: 'none' };

  const dispatchState = message.dispatch?.state as OutboundDispatchState | undefined;
  const waStatus = message.whatsappDelivery?.status;

  if (dispatchState === 'uncertain') {
    return {
      visual: 'uncertain',
      errorMessage: operatorFacingError(
        message.whatsappDelivery?.errorMessage,
        message.whatsappDelivery?.errorCode,
        message.dispatch?.error,
      ),
    };
  }

  if (dispatchState === 'failed') {
    return {
      visual: 'failed',
      errorMessage: operatorFacingError(
        message.whatsappDelivery?.errorMessage,
        message.whatsappDelivery?.errorCode,
        message.dispatch?.error,
      ),
    };
  }

  if (waStatus && FAILURE_WA.includes(waStatus)) {
    return {
      visual: 'failed',
      errorMessage: operatorFacingError(
        message.whatsappDelivery?.errorMessage,
        message.whatsappDelivery?.errorCode,
        message.dispatch?.error,
      ),
    };
  }

  if (waStatus === 'read') return { visual: 'read' };
  if (waStatus === 'delivered') return { visual: 'delivered' };
  if (waStatus === 'sent') return { visual: 'sent' };
  if (waStatus === 'queued' || waStatus === 'sending' || waStatus === 'accepted') {
    return { visual: 'pending' };
  }

  if (dispatchState === 'pending') return { visual: 'pending' };
  if (dispatchState === 'confirmed' || message.providerMessageId) return { visual: 'sent' };

  return { visual: 'none' };
}