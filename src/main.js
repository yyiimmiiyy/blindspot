'use strict';
const { app, BrowserWindow, ipcMain, shell, safeStorage, clipboard, Menu } = require('electron');
const path = require('node:path');
const { createGitHub, parseRepo } = require('./core/github');
const { createClaude, MODELS } = require('./core/claude');
const { findGaps, toMarkdown } = require('./core/gaps');
const { createSettings } = require('./core/settings');

let settings;
let win;

function clients() {
  const s = settings.secrets();
  if (!s.githubToken) throw new Error('Add your GitHub access token in Settings first.');
  return { github: createGitHub({ token: s.githubToken }), makeClaude: () => createClaude({ apiKey: s.anthropicKey, model: s.model }) };
}

// Errors cross the IPC boundary as plain data so the window can show them.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { ok: true, data: await fn(payload || {}) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  });
}

function registerHandlers() {
  handle('settings:get', () => ({ ...settings.publicView(), models: MODELS }));
  handle('settings:save', (p) => { settings.save(p); return settings.publicView(); });

  handle('pulls:list', async ({ repo, state }) => {
    const r = parseRepo(repo);
    const pulls = await clients().github.listPulls(r.owner, r.repo, state);
    settings.save({ lastRepo: `${r.owner}/${r.repo}` });
    return { repo: `${r.owner}/${r.repo}`, pulls };
  });

  handle('gaps:find', async ({ repo, number }) => {
    const r = parseRepo(repo);
    const { github, makeClaude } = clients();
    return findGaps({ github, claude: makeClaude(), owner: r.owner, repo: r.repo, number });
  });

  handle('gaps:copy', ({ report, pull }) => { clipboard.writeText(toMarkdown(report, { pull })); return true; });

  handle('gaps:post', async ({ repo, number, report, pull }) => {
    const r = parseRepo(repo);
    return clients().github.createComment(r.owner, r.repo, number, toMarkdown(report, { pull }));
  });

  handle('open:external', ({ url }) => {
    const u = new URL(url);
    const allowed = ['github.com', 'console.anthropic.com', 'platform.claude.com'];
    if (u.protocol !== 'https:' || !allowed.includes(u.hostname)) throw new Error('That link is not allowed.');
    return shell.openExternal(u.toString());
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    title: 'Blindspot',
    backgroundColor: '#f6f4ef',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // The window only ever shows our own page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  settings = createSettings({ dir: app.getPath('userData'), crypto: safeStorage });
  Menu.setApplicationMenu(null);
  registerHandlers();
  createWindow();
  if (process.env.BLINDSPOT_SMOKE) {
    win.webContents.once('did-finish-load', () => { console.log('BLINDSPOT_SMOKE_OK'); app.quit(); });
  }
});

app.on('window-all-closed', () => app.quit());
