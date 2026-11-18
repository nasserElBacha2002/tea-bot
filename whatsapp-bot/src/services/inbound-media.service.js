import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import {
  classifyInboundDownloadFailure,
  computeInboundMediaRetryDelayMs,
  extensionForInboundMime,
  isAllowedInboundMime,
  isPermanentInboundMediaFailure,
  normalizeInboundMimeType,
  sanitizeAttachmentDisplayName,
  sniffInboundMediaContent,
} from '../utils/inbound-media-policy.js';
import {
  deleteInboundMediaObject,
  resolveInboundMediaRoot,
  verifyInboundMediaObject,
  writeInboundMediaObject,
} from '../utils/inbound-media-storage.js';
import { assertTwilioMediaUrl, fetchTwilioMediaWithRedirects } from '../utils/twilio-media-url.js';

function buildBasicAuthHeader() {
  const sid = String(config.twilioAccountSid || '').trim();
  const token = String(config.twilioAuthToken || '').trim();
  if (!sid || !token) return null;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

/** @deprecated usar fetchTwilioMediaWithRedirects en tests nuevos */
export async function downloadTwilioMedia(url, options) {
  return fetchTwilioMediaWithRedirects(url, options);
}

class InboundMediaService {
  isEnabled() {
    return Boolean(config.inboundMediaEnabled);
  }

  allowedMimes() {
    return config.inboundMediaAllowedMimeTypes;
  }

  /**
   * Webhook: solo filas pending (rápido). La descarga corre en el worker.
   */
  async ensureInboundAttachmentRows({ conversation, message, event }) {
    const media = Array.isArray(event?.media) ? event.media : [];
    if (!this.isEnabled() || !media.length || !message?.id || !conversation?.id) return [];

    const rows = [];
    for (let ordinal = 0; ordinal < media.length; ordinal += 1) {
      const item = media[ordinal];
      let sourceUrl = null;
      try {
        sourceUrl = assertTwilioMediaUrl(item.url);
      } catch {
        sourceUrl = null;
      }
      const row = await attachmentRepository.upsertPending({
        messageId: message.id,
        conversationId: conversation.id,
        ordinal,
        providerMediaIndex: item.index ?? ordinal,
        mimeType: normalizeInboundMimeType(item.contentType) || null,
        originalName: sanitizeAttachmentDisplayName(item.fileName),
        sourceUrl,
      });
      if (!sourceUrl && row?.status === 'pending') {
        const failed = await attachmentRepository.markFailed(row.id, 'url_not_allowed');
        rows.push(failed);
        continue;
      }
      rows.push(row);
    }
    return rows;
  }

  /**
   * @deprecated alias webhook
   */
  async persistForInboundMessage(params) {
    return this.ensureInboundAttachmentRows(params);
  }

  async processAttachmentRow(row) {
    if (!row?.id || !this.isEnabled()) return row;
    if (row.status === 'stored' && row.storageKey) {
      const root = resolveInboundMediaRoot();
      const ok = await verifyInboundMediaObject(root, row.storageKey).catch(() => false);
      if (ok) return row;
      await attachmentRepository.markFailed(row.id, 'store_fs_verify_failed');
      row = await attachmentRepository.findById(row.id);
    }
    if (row.status === 'stored') return row;
    if (isPermanentInboundMediaFailure(row.failureReason)) return row;

    const acquired = await attachmentRepository.tryAcquireForDownload(row.id, {
      expectedStatus: row.status,
      expectedRetryCount: row.retryCount ?? 0,
    });
    if (!acquired) return row;

    return this._downloadAndStore(acquired);
  }

  async _downloadAndStore(row) {
    const allowed = this.allowedMimes();
    const mimeDeclared = normalizeInboundMimeType(row.mimeType);
    if (mimeDeclared && !isAllowedInboundMime(mimeDeclared, allowed)) {
      return attachmentRepository.markFailed(row.id, 'mime_not_allowed');
    }

    const authHeader = buildBasicAuthHeader();
    if (!authHeader) {
      return attachmentRepository.markFailed(row.id, 'twilio_not_configured');
    }

    let sourceUrl;
    try {
      sourceUrl = assertTwilioMediaUrl(row.sourceUrl);
    } catch {
      return attachmentRepository.markFailed(row.id, 'url_not_allowed');
    }

    let buffer;
    let byteSize;
    let headerMime;
    try {
      const downloaded = await fetchTwilioMediaWithRedirects(sourceUrl, {
        authHeader,
        timeoutMs: config.inboundMediaDownloadTimeoutMs,
        maxBytes: config.inboundMediaMaxBytes,
      });
      buffer = downloaded.buffer;
      byteSize = downloaded.byteSize;
      headerMime = normalizeInboundMimeType(downloaded.resolvedMime);
    } catch (error) {
      const reason = classifyInboundDownloadFailure(error);
      return this._failWithRetry(row, reason);
    }

    const sniffed = sniffInboundMediaContent(buffer);
    if (!sniffed) {
      return attachmentRepository.markFailed(row.id, 'content_invalid');
    }
    const effectiveMime = sniffed;
    if (mimeDeclared && mimeDeclared !== effectiveMime) {
      return attachmentRepository.markFailed(row.id, 'content_invalid');
    }
    if (headerMime && headerMime !== effectiveMime) {
      return attachmentRepository.markFailed(row.id, 'content_invalid');
    }
    if (!isAllowedInboundMime(effectiveMime, allowed)) {
      return attachmentRepository.markFailed(row.id, 'mime_not_allowed');
    }

    const storageKey = `${randomUUID().replace(/-/g, '')}${extensionForInboundMime(effectiveMime)}`;
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const root = resolveInboundMediaRoot();
    try {
      await writeInboundMediaObject(root, storageKey, buffer);
    } catch (error) {
      return this._failWithRetry(row, 'store_fs_write_failed');
    }

    let stored;
    try {
      stored = await attachmentRepository.markStored(row.id, {
        storageKey,
        byteSize,
        sha256,
        mimeType: effectiveMime,
      });
    } catch (error) {
      await deleteInboundMediaObject(root, storageKey).catch(() => {});
      return this._failWithRetry(row, 'store_commit_failed');
    }

    if (!stored || stored.status !== 'stored') {
      await deleteInboundMediaObject(root, storageKey).catch(() => {});
      return this._failWithRetry(row, 'store_commit_failed');
    }

    const verified = await verifyInboundMediaObject(root, storageKey).catch(() => false);
    if (!verified) {
      await attachmentRepository.markFailed(row.id, 'store_fs_verify_failed');
      await deleteInboundMediaObject(root, storageKey).catch(() => {});
      return attachmentRepository.findById(row.id);
    }

    return stored;
  }

  async _failWithRetry(row, reason) {
    if (isPermanentInboundMediaFailure(reason)) {
      return attachmentRepository.markFailed(row.id, reason);
    }
    const retryCount = Number(row.retryCount ?? 0) + 1;
    if (retryCount >= config.inboundMediaMaxRetries) {
      return attachmentRepository.markFailed(row.id, reason);
    }
    const delayMs = computeInboundMediaRetryDelayMs(retryCount, config.inboundMediaRetryBaseMs);
    const nextRetryAt = new Date(Date.now() + delayMs);
    return attachmentRepository.markFailed(row.id, reason, { retryAt: nextRetryAt });
  }

  /**
   * Simulador / carga directa: sin Twilio, persiste en almacenamiento privado DIN-439.
   */
  async storeSimulatorUpload({
    conversation,
    message,
    buffer,
    mimeType,
    originalName,
    ordinal = 0,
  }) {
    if (!conversation?.id || !message?.id || !Buffer.isBuffer(buffer)) {
      throw Object.assign(new Error('upload_invalid'), { code: 'VALIDATION' });
    }
    const allowed = this.allowedMimes();
    const maxBytes = config.inboundMediaMaxBytes;
    if (buffer.length === 0) throw Object.assign(new Error('content_empty'), { code: 'VALIDATION' });
    if (buffer.length > maxBytes) throw Object.assign(new Error('size_limit_exceeded'), { code: 'VALIDATION' });

    const headerMime = normalizeInboundMimeType(mimeType);
    const sniffed = sniffInboundMediaContent(buffer);
    const effectiveMime = sniffed || headerMime;
    if (!effectiveMime || !isAllowedInboundMime(effectiveMime, allowed)) {
      throw Object.assign(new Error('mime_not_allowed'), { code: 'VALIDATION' });
    }
    if (sniffed && headerMime && sniffed !== headerMime) {
      throw Object.assign(new Error('content_invalid'), { code: 'VALIDATION' });
    }

    const row = await attachmentRepository.upsertPending({
      messageId: message.id,
      conversationId: conversation.id,
      ordinal,
      providerMediaIndex: ordinal,
      mimeType: effectiveMime,
      originalName: sanitizeAttachmentDisplayName(originalName),
      sourceUrl: null,
    });
    const acquired = await attachmentRepository.tryAcquireForDownload(row.id, {
      expectedStatus: 'pending',
      expectedRetryCount: row.retryCount ?? 0,
    });
    if (!acquired) return attachmentRepository.findById(row.id);

    const storageKey = `${randomUUID().replace(/-/g, '')}${extensionForInboundMime(effectiveMime)}`;
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const root = resolveInboundMediaRoot();
    await writeInboundMediaObject(root, storageKey, buffer);
    const stored = await attachmentRepository.markStored(acquired.id, {
      storageKey,
      byteSize: buffer.length,
      sha256,
      mimeType: effectiveMime,
    });
    return stored;
  }

  async deleteStoredObjects(storageKeys) {
    const root = resolveInboundMediaRoot();
    let deleted = 0;
    let failed = 0;
    for (const key of storageKeys || []) {
      try {
        await deleteInboundMediaObject(root, key);
        deleted += 1;
      } catch {
        failed += 1;
      }
    }
    return { deleted, failed };
  }
}

const inboundMediaService = new InboundMediaService();
export default inboundMediaService;