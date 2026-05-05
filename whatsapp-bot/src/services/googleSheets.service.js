import { google } from 'googleapis';
import { config } from '../config.js';

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

  async ensureHeaders(tabName, headers) {
    if (!Array.isArray(headers) || headers.length === 0) return;
    const tabKey = String(tabName || '').trim().toLowerCase();
    if (!tabKey || this.headersCheckedTabs.has(tabKey)) return;
    const sheets = await this._getClient();
    const range = `${tabName}!A1:${String.fromCharCode(64 + Math.min(26, headers.length))}1`;
    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: config.googleSheetsSpreadsheetId,
      range,
    });
    const existing = Array.isArray(current.data?.values?.[0]) ? current.data.values[0] : [];
    if (existing.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.googleSheetsSpreadsheetId,
        range: `${tabName}!A1`,
        valueInputOption: 'RAW',
        requestBody: {
          values: [headers],
        },
      });
    }
    this.headersCheckedTabs.add(tabKey);
  }

  async appendRow({ rowValues, tabName, headers = [] }) {
    if (!this.isEnabled()) return { skipped: true, reason: 'disabled' };
    if (!this.hasRequiredConfig()) {
      return { skipped: true, reason: 'missing_config', missingKeys: this.missingConfigKeys() };
    }
    const targetTab = String(tabName || config.googleSheetsTabName || '').trim();
    if (!targetTab) return { skipped: true, reason: 'missing_tab_name' };
    const sheets = await this._getClient();
    await this.ensureHeaders(targetTab, headers);
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
