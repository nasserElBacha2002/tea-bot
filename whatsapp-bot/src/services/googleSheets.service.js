import { google } from 'googleapis';
import { config } from '../config.js';

export function columnToLetter(index) {
  let n = index + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

class GoogleSheetsService {
  constructor() {
    this.sheetsClient = null;
    this.headersCheckedTabs = new Set();
  }

  isEnabled() {
    return Boolean(config.googleSheetsEnabled);
  }

  _requiredKeys() {
    return [
      'googleSheetsSpreadsheetId',
      'googleSheetsTabName',
      'googleServiceAccountEmail',
      'googlePrivateKey',
    ];
  }

  hasRequiredConfig() {
    return this._requiredKeys().every((key) => Boolean(config[key]));
  }

  missingConfigKeys() {
    const mapping = {
      googleSheetsSpreadsheetId: 'GOOGLE_SHEETS_SPREADSHEET_ID',
      googleSheetsTabName: 'GOOGLE_SHEETS_TAB_NAME',
      googleServiceAccountEmail: 'GOOGLE_SERVICE_ACCOUNT_EMAIL',
      googlePrivateKey: 'GOOGLE_PRIVATE_KEY',
    };
    return this._requiredKeys()
      .filter((key) => !config[key])
      .map((key) => mapping[key] || key);
  }

  async _getClient() {
    if (this.sheetsClient) return this.sheetsClient;
    const auth = new google.auth.JWT({
      email: config.googleServiceAccountEmail,
      key: String(config.googlePrivateKey || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheetsClient = google.sheets({ version: 'v4', auth });
    return this.sheetsClient;
  }

  _tabKey(tabName) {
    return String(tabName || '').trim().toLowerCase();
  }

  async readTabValues(tabName) {
    if (!this.hasRequiredConfig()) return [];
    const targetTab = String(tabName || config.googleSheetsTabName || '').trim();
    if (!targetTab) return [];
    const sheets = await this._getClient();
    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: config.googleSheetsSpreadsheetId,
      range: `${targetTab}!A:Z`,
    });
    return Array.isArray(current.data?.values) ? current.data.values : [];
  }

  /**
   * Garantiza headers presentes. Agrega columnas faltantes al final sin duplicar.
   * @returns {Promise<{ headers: string[], emailColumnIndex: number }>}
   */
  async ensureHeaderColumns(tabName, expectedHeaders = []) {
    const targetTab = String(tabName || config.googleSheetsTabName || '').trim();
    if (!targetTab || !Array.isArray(expectedHeaders) || expectedHeaders.length === 0) {
      return { headers: expectedHeaders, emailColumnIndex: -1 };
    }

    const sheets = await this._getClient();
    const values = await this.readTabValues(targetTab);
    const existing = Array.isArray(values[0]) ? [...values[0]] : [];
    let merged = existing.length > 0 ? [...existing] : [...expectedHeaders];

    if (existing.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.googleSheetsSpreadsheetId,
        range: `${targetTab}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [merged] },
      });
    } else {
      let added = false;
      for (const header of expectedHeaders) {
        if (!merged.includes(header)) {
          merged.push(header);
          added = true;
        }
      }
      if (added) {
        const endCol = columnToLetter(merged.length - 1);
        await sheets.spreadsheets.values.update({
          spreadsheetId: config.googleSheetsSpreadsheetId,
          range: `${targetTab}!A1:${endCol}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [merged] },
        });
      }
    }

    this.headersCheckedTabs.add(this._tabKey(targetTab));
    const emailColumnIndex = merged.indexOf('Email');
    return { headers: merged, emailColumnIndex };
  }

  async ensureHeaders(tabName, headers) {
    if (!this.isEnabled() || !this.hasRequiredConfig()) return;
    await this.ensureHeaderColumns(tabName, headers);
  }

  async updateCell(tabName, a1Range, value) {
    if (!this.hasRequiredConfig()) {
      return { skipped: true, reason: 'missing_config', missingKeys: this.missingConfigKeys() };
    }
    const targetTab = String(tabName || config.googleSheetsTabName || '').trim();
    if (!targetTab) return { skipped: true, reason: 'missing_tab_name' };
    const sheets = await this._getClient();
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.googleSheetsSpreadsheetId,
      range: `${targetTab}!${a1Range}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[value]] },
    });
    return { skipped: false, updated: true };
  }

  async appendRow({ rowValues, tabName, headers = [] }) {
    if (!this.isEnabled()) return { skipped: true, reason: 'disabled' };
    if (!this.hasRequiredConfig()) {
      return { skipped: true, reason: 'missing_config', missingKeys: this.missingConfigKeys() };
    }
    const targetTab = String(tabName || config.googleSheetsTabName || '').trim();
    if (!targetTab) return { skipped: true, reason: 'missing_tab_name' };
    const sheets = await this._getClient();
    await this.ensureHeaderColumns(targetTab, headers);
    await sheets.spreadsheets.values.append({
      spreadsheetId: config.googleSheetsSpreadsheetId,
      range: `${targetTab}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [rowValues],
      },
    });
    return { skipped: false };
  }

  async appendConversationRow(rowValues, options = {}) {
    return this.appendRow({
      rowValues,
      tabName: options.tabName || config.googleSheetsTabName,
      headers: options.headers || [],
    });
  }
}

const googleSheetsService = new GoogleSheetsService();
export default googleSheetsService;
