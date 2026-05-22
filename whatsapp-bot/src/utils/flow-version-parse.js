/**
 * @param {string} filename ej. v19.json
 * @returns {{ versionNumber: number, versionLabel: string } | null}
 */
export function parsePublishedVersionFromFilename(filename) {
  const m = /^v(\d+)\.json$/i.exec(String(filename || '').trim());
  if (!m) return null;
  const num = parseInt(m[1], 10);
  return { versionNumber: num, versionLabel: `v${num}` };
}

/** Draft único por flow: version_number = 0 */
export const DRAFT_VERSION_NUMBER = 0;
