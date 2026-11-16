import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultFixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/whatsapp-rate-card-ar.sample.json',
);

let cachedCard = null;
let cachedPath = null;

export function loadRateCard(filePath = process.env.WHATSAPP_RATE_CARD_PATH || defaultFixture) {
  if (cachedCard && cachedPath === filePath) return cachedCard;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    return null;
  }
  const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  cachedCard = raw;
  cachedPath = filePath;
  return raw;
}

export function resetRateCardCache() {
  cachedCard = null;
  cachedPath = null;
}

export function rateCardMetaLimitation(rateCard) {
  if (!rateCard) {
    return {
      available: false,
      reason: 'RATE_CARD_NOT_LOADED',
      operationalQuality: 'unavailable',
    };
  }
  return {
    available: true,
    operationalQuality: 'fixture_illustrative_only',
    countryIso: rateCard.countryIso,
    sources: rateCard.sources || [],
    disclaimer:
      'No usar este fixture como tarifa confirmada. Gasto confirmado = Usage Records Twilio del período.',
  };
}