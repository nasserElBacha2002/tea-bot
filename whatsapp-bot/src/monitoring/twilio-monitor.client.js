import axios from 'axios';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function safeError(error) {
  const status = error?.response?.status || null;
  const message = error?.response?.data?.message || error?.message || 'twilio_request_failed';
  return { status, message: String(message).slice(0, 200) };
}

async function defaultRequest({ url, accountSid, authToken, timeoutMs }) {
  const response = await axios.get(url, {
    auth: { username: accountSid, password: authToken },
    timeout: timeoutMs,
    validateStatus: () => true,
  });
  return { status: response.status, data: response.data };
}

function normalizeSender(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const webhook = raw.webhook && typeof raw.webhook === 'object' ? raw.webhook : null;
  return {
    sid: raw.sid || raw.sender_sid || null,
    status: raw.status || null,
    qualityRating: raw.quality_rating || raw.qualityRating || null,
    offlineReasons: raw.offline_reasons || raw.offlineReasons || null,
    webhookUrl: webhook?.callback_url || webhook?.callbackUrl || raw.webhook_url || null,
    senderId: raw.sender_id || raw.senderId || null,
  };
}

function pickSender(senders, fromAddress) {
  const wanted = digits(fromAddress);
  if (!wanted) return senders[0] || null;
  return senders.find((sender) => digits(sender.senderId).endsWith(wanted) || wanted.endsWith(digits(sender.senderId)))
    || senders[0]
    || null;
}

/**
 * Read-only Twilio snapshot. The injectable request receives the URL only
 * when tests pass it; production auth stays inside the HTTP call.
 *
 * @param {{
 *   accountSid?: string,
 *   authToken?: string,
 *   fromAddress?: string,
 *   timeoutMs?: number,
 *   request?: (input: { url: string, accountSid?: string, authToken?: string, timeoutMs?: number }) => Promise<{ status: number, data: unknown }>,
 * }} input
 */
export async function collectTwilioSnapshot(input) {
  const started = Date.now();
  const checkedAt = new Date().toISOString();
  if (!input.accountSid || !input.authToken) {
    return {
      ok: false,
      accountStatus: null,
      balance: null,
      currency: null,
      senderStatus: null,
      qualityRating: null,
      offlineReasons: null,
      senderSid: null,
      webhookUrl: null,
      checkedAt,
      latencyMs: 0,
      error: 'not_configured',
      messages: [],
      messagesTruncated: false,
    };
  }

  const timeoutMs = input.timeoutMs || 15000;
  const call = (url) => (input.request
    ? input.request({ url })
    : defaultRequest({
      url,
      accountSid: input.accountSid,
      authToken: input.authToken,
      timeoutMs,
    }));

  try {
    const accountUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}.json`;
    const account = await call(accountUrl);
    if (account.status < 200 || account.status >= 300) {
      return {
        ok: false,
        accountStatus: null,
        balance: null,
        currency: null,
        senderStatus: null,
        qualityRating: null,
        offlineReasons: null,
        senderSid: null,
        webhookUrl: null,
        checkedAt,
        latencyMs: Date.now() - started,
        error: 'account_query_failed',
        messages: [],
        messagesTruncated: false,
      };
    }

    const balanceResponse = await call(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Balance.json`,
    );
    const balanceValue = Number(balanceResponse.data?.balance);
    const balance = balanceResponse.status >= 200 && balanceResponse.status < 300 && Number.isFinite(balanceValue)
      ? balanceValue
      : null;

    let sender = null;
    let senderError = null;
    try {
      const sendersResponse = await call('https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=20');
      if (sendersResponse.status >= 200 && sendersResponse.status < 300) {
        const list = sendersResponse.data?.senders || sendersResponse.data?.Senders || [];
        const normalized = (Array.isArray(list) ? list : []).map(normalizeSender).filter(Boolean);
        sender = pickSender(normalized, input.fromAddress);
      } else {
        senderError = 'sender_query_failed';
      }
    } catch (error) {
      senderError = safeError(error).message;
    }

    return {
      ok: true,
      accountStatus: account.data?.status || null,
      balance,
      currency: balanceResponse.data?.currency || null,
      senderStatus: sender?.status || null,
      qualityRating: sender?.qualityRating || null,
      offlineReasons: sender?.offlineReasons ?? null,
      senderSid: sender?.sid || null,
      webhookUrl: sender?.webhookUrl || null,
      senderError,
      checkedAt,
      latencyMs: Date.now() - started,
      error: null,
      messages: [],
      messagesTruncated: false,
    };
  } catch (error) {
    return {
      ok: false,
      accountStatus: null,
      balance: null,
      currency: null,
      senderStatus: null,
      qualityRating: null,
      offlineReasons: null,
      senderSid: null,
      webhookUrl: null,
      checkedAt,
      latencyMs: Date.now() - started,
      error: safeError(error).message,
      messages: [],
      messagesTruncated: false,
    };
  }
}

export async function listRecentTwilioMessageSids(input) {
  if (!input.accountSid || !input.authToken) {
    return { ok: false, error: 'not_configured', sids: [], truncated: false };
  }
  const day = new Date(Date.now() - Number(input.lookbackMinutes || 60) * 60 * 1000);
  const dayStamp = day.toISOString().slice(0, 10);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Messages.json?PageSize=100&DateSent%3E=${dayStamp}`;
  try {
    const response = input.request
      ? await input.request({ url })
      : await defaultRequest({
        url,
        accountSid: input.accountSid,
        authToken: input.authToken,
        timeoutMs: input.timeoutMs || 15000,
      });
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, error: 'messages_query_failed', sids: [], truncated: false };
    }
    const messages = Array.isArray(response.data?.messages) ? response.data.messages : [];
    const cutoff = Date.now() - Number(input.lookbackMinutes || 60) * 60 * 1000;
    const inbound = messages.filter((message) => {
      const direction = String(message.direction || '').toLowerCase();
      const sentAt = new Date(message.date_sent || message.date_created || 0).getTime();
      return direction.startsWith('inbound') && Number.isFinite(sentAt) && sentAt >= cutoff;
    });
    return {
      ok: true,
      error: null,
      sids: inbound.map((message) => message.sid).filter(Boolean),
      truncated: messages.length >= 100,
    };
  } catch (error) {
    return { ok: false, error: safeError(error).message, sids: [], truncated: false };
  }
}
