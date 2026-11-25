/**
 * Mock stateful de Google Sheets para pruebas de idempotencia / concurrencia.
 */
export class GoogleSheetsMockStore {
  constructor() {
    this.tabs = new Map();
    this.appendCalls = 0;
    this.updateCalls = 0;
    this.batchUpdateCalls = 0;
    this.simulateLostAppendResponse = false;
    this.simulateTimeoutAfterAppend = false;
    this.appendBarrier = null;
  }

  setAppendBarrier(promise) {
    this.appendBarrier = promise;
  }

  ensureTab(tabName, headers = []) {
    if (!this.tabs.has(tabName)) {
      this.tabs.set(tabName, { headers: [...headers], rows: [] });
    }
    const tab = this.tabs.get(tabName);
    if (tab.headers.length === 0 && headers.length > 0) {
      tab.headers = [...headers];
    }
    return tab;
  }

  readTabValues(tabName) {
    const tab = this.tabs.get(tabName) || { headers: [], rows: [] };
    if (tab.headers.length === 0) return [];
    return [tab.headers, ...tab.rows];
  }

  countRowsForConversation(tabName, conversationId, headerName = 'Conversation ID') {
    const tab = this.tabs.get(tabName);
    if (!tab) return 0;
    const idx = tab.headers.indexOf(headerName);
    if (idx < 0) return 0;
    return tab.rows.filter((row) => String(row[idx]) === String(conversationId)).length;
  }

  async appendRow(tabName, rowValues, { headers = [] }) {
    if (this.appendBarrier) {
      await this.appendBarrier;
    }
    this.appendCalls += 1;
    const tab = this.ensureTab(tabName, headers);
    tab.rows.push([...rowValues]);
    const rowNumber = tab.rows.length + 1;
    if (this.simulateLostAppendResponse) {
      return { skipped: false, updatedRange: null, lostResponse: true, rowNumber };
    }
    if (this.simulateTimeoutAfterAppend) {
      const err = new Error('timeout');
      err.code = 'ETIMEDOUT';
      throw err;
    }
    return { skipped: false, updatedRange: `${tabName}!A${rowNumber}`, rowNumber };
  }

  updateManagedCells(tabName, headers, sheetRowNumber, updatesByHeader) {
    this.batchUpdateCalls += 1;
    const tab = this.tabs.get(tabName);
    if (!tab) return { skipped: true, reason: 'missing_tab' };
    const index = sheetRowNumber - 2;
    if (index < 0 || index >= tab.rows.length) return { skipped: true, reason: 'missing_row' };
    const row = [...tab.rows[index]];
    for (const [header, value] of Object.entries(updatesByHeader)) {
      const col = headers.indexOf(header);
      if (col < 0) continue;
      while (row.length <= col) row.push('');
      row[col] = value;
    }
    tab.rows[index] = row;
    return { skipped: false, updated: true, cells: Object.keys(updatesByHeader).length };
  }

  updateRow(tabName, rowNumber, rowValues) {
    this.updateCalls += 1;
    const tab = this.tabs.get(tabName);
    if (!tab) return { skipped: true, reason: 'missing_tab' };
    const index = rowNumber - 2;
    if (index < 0 || index >= tab.rows.length) return { skipped: true, reason: 'missing_row' };
    tab.rows[index] = [...rowValues];
    return { skipped: false, updated: true };
  }

  getRow(tabName, rowNumber) {
    const tab = this.tabs.get(tabName);
    if (!tab) return null;
    return tab.rows[rowNumber - 2] || null;
  }
}