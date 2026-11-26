/** Enteros en micro-dólares (1e-6 USD) para evitar drift de float. */
export function toMicroUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 1_000_000);
}

export function fromMicroUsd(micro) {
  if (micro == null || !Number.isFinite(micro)) return null;
  return Math.round(micro) / 1_000_000;
}

export function addMicro(a, b) {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

export function mulCount(rateMicro, count) {
  if (rateMicro == null) return null;
  const n = Math.max(0, Number(count) || 0);
  return Math.round(rateMicro * n);
}

export function roundUsd4(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
}