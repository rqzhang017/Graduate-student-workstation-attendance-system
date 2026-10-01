const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const ROOT = path.join(__dirname, '..');
const profilePath = path.join(os.tmpdir(), 'attendance-electron-smoke-profile');
const screenshotPath = process.env.ATTENDANCE_SMOKE_SCREENSHOT || '';

const profileParent = path.resolve(path.dirname(profilePath)).toLowerCase();
const expectedProfileParent = path.resolve(os.tmpdir()).toLowerCase();
assert.equal(profileParent, expectedProfileParent, '冒烟测试用户目录必须位于系统 Temp 下');
assert.equal(path.basename(profilePath), 'attendance-electron-smoke-profile');
fs.rmSync(profilePath, { recursive: true, force: true });
fs.mkdirSync(profilePath, { recursive: true });

app.setPath('userData', profilePath);
app.commandLine.appendSwitch('disable-gpu');

let mainWindow = null;
let floatingWindow = null;
let floatingReady = false;
let latestFocusState = {
  active: false,
  mode: 'countdown',
  status: 'idle',
  title: '',
  elapsedMs: 0,
  remainingMs: 0,
  updatedAt: Date.now()
};
const runtimeErrors = [];

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function observeWebContents(webContents, label) {
  webContents.on('console-message', function(event) {
    const message = event && event.message;
    if (/\b(Uncaught|TypeError|ReferenceError|SyntaxError|Unhandled)\b/i.test(String(message || ''))) {
      runtimeErrors.push(`${label}: ${message}`);
    }
  });
  webContents.on('render-process-gone', (_event, details) => {
    runtimeErrors.push(`${label}: renderer gone (${details.reason})`);
  });
  webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) runtimeErrors.push(`${label}: load failed ${code} ${description} ${url}`);
  });
}

function registerIpcStubs() {
  [
    'focus-reminder:schedule',
    'focus-reminder:cancel',
    'focus-reminder:acknowledge',
    'rest-reminder:schedule',
    'rest-reminder:cancel',
    'rest-reminder:acknowledge',
    'sedentary-reminder:schedule',
    'sedentary-reminder:cancel',
    'sedentary-reminder:acknowledge',
    'checkin-reminder:sync',
    'checkin-reminder:clear',
    'window:show',
    'floating-window:show',
    'floating-window:hide'
  ].forEach(channel => ipcMain.handle(channel, () => ({ ok: true })));

  ipcMain.handle('floating-window:set-collapsed', (_event, payload = {}) => ({
    ok: true,
    collapsed: Boolean(payload.collapsed)
  }));
  ipcMain.handle('desktop-settings:get', () => ({
    autoLaunch: true,
    shortcutEnabled: true,
    shortcut: 'Ctrl+Alt+T',
    floatingCollapsed: false,
    shortcutStatus: { ok: true, message: '' }
  }));
  ipcMain.handle('desktop-settings:update', (_event, settings = {}) => ({ ok: true, settings }));
  ipcMain.handle('focus-control:ready', () => ({ ok: true, requestState: true, queuedCount: 0 }));
  ipcMain.handle('focus-control:get-state', () => ({ ...latestFocusState }));
  ipcMain.handle('focus-control:command', () => ({ ok: true }));
  ipcMain.handle('focus-control:publish-state', (_event, state = {}) => {
    latestFocusState = { ...latestFocusState, ...state };
    if (floatingReady && floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.webContents.send('focus-control:state', latestFocusState);
    }
    return { ok: true };
  });
}

async function readAppSnapshot() {
  return mainWindow.webContents.executeJavaScript(`(() => {
    const raw = localStorage.getItem('phdWorkstationAppState');
    const snapshot = raw ? JSON.parse(raw) : null;
    return {
      snapshot,
      stopwatchText: document.getElementById('stopwatch-display').textContent,
      stopwatchStatus: document.getElementById('stopwatch-session-status').textContent,
      stopwatchInput: document.getElementById('stopwatch-session-name').value,
      focusLedgerAvailable: Boolean(window.FocusLedger),
      activeEffectiveMs: snapshot && snapshot.currentFocusSession
        ? window.FocusLedger.getEffectiveDurationMs(snapshot.currentFocusSession, Date.now())
        : 0
    };
  })()`);
}

async function runSmokeTest() {
  registerIpcStubs();

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });
  floatingWindow = new BrowserWindow({
    width: 360,
    height: 150,
    show: false,
    frame: false,
    webPreferences: {
      preload: path.join(ROOT, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  observeWebContents(mainWindow.webContents, 'main');
  observeWebContents(floatingWindow.webContents, 'floating');
  floatingWindow.webContents.on('did-finish-load', () => {
    floatingReady = true;
    floatingWindow.webContents.send('focus-control:state', latestFocusState);
  });

  await Promise.all([
    mainWindow.loadFile(path.join(ROOT, '研究生工位打卡与时间管理系统.html')),
    floatingWindow.loadFile(path.join(ROOT, 'electron', 'floating.html'))
  ]);
  await delay(900);

  const initial = await readAppSnapshot();
  assert.equal(initial.focusLedgerAvailable, true);
  assert.ok(initial.snapshot, '主应用状态快照未创建');
  const initialTaskData = JSON.stringify(initial.snapshot.taskData);
  const initialCurrentTask = JSON.stringify(initial.snapshot.currentTask);

  mainWindow.webContents.send('focus-control:command', {
    action: 'start',
    payload: { title: 'Electron 冒烟测试' },
    issuedAt: Date.now()
  });
  await delay(2300);

  const running = await readAppSnapshot();
  assert.equal(running.snapshot.currentFocusSession.mode, 'stopwatch');
  assert.equal(running.snapshot.currentFocusSession.title, 'Electron 冒烟测试');
  assert.ok(running.activeEffectiveMs >= 1500);
  assert.equal(JSON.stringify(running.snapshot.taskData), initialTaskData);
  assert.equal(JSON.stringify(running.snapshot.currentTask), initialCurrentTask);

  const floatingMetrics = await floatingWindow.webContents.executeJavaScript(`(() => ({
    activeView: document.getElementById('stopwatch-view').classList.contains('visible'),
    time: document.getElementById('stopwatch-time').textContent,
    title: document.getElementById('stopwatch-title').textContent,
    bodyHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight
  }))()`);
  assert.equal(floatingMetrics.activeView, true);
  assert.notEqual(floatingMetrics.time, '00:00:00');
  assert.match(floatingMetrics.title, /Electron 冒烟测试/);
  assert.ok(floatingMetrics.bodyHeight <= floatingMetrics.viewportHeight, '悬浮窗出现垂直溢出');

  if (screenshotPath) {
    const image = await floatingWindow.webContents.capturePage();
    fs.writeFileSync(screenshotPath, image.toPNG());
  }

  mainWindow.webContents.send('focus-control:command', { action: 'pause', payload: {}, issuedAt: Date.now() });
  await delay(250);
  const pausedBefore = await readAppSnapshot();
  assert.equal(pausedBefore.snapshot.currentFocusSession.status, 'paused');
  assert.equal(pausedBefore.snapshot.currentFocusSession.pauses.length, 1);
  assert.equal(pausedBefore.snapshot.currentFocusSession.pauses[0].endTimestamp, null);

  await delay(650);
  const pausedAfter = await readAppSnapshot();
  const pauseStart = pausedAfter.snapshot.currentFocusSession.pauses[0].startTimestamp;
  assert.equal(pausedAfter.snapshot.currentFocusSession.status, 'paused');
  assert.ok(pauseStart > pausedAfter.snapshot.currentFocusSession.startTimestamp);
  assert.ok(pausedBefore.activeEffectiveMs > 0);
  assert.ok(Math.abs(pausedAfter.activeEffectiveMs - pausedBefore.activeEffectiveMs) < 5);
  assert.equal(pausedAfter.stopwatchText, pausedBefore.stopwatchText);

  mainWindow.webContents.send('focus-control:command', { action: 'resume', payload: {}, issuedAt: Date.now() });
  await delay(450);
  mainWindow.webContents.send('focus-control:command', { action: 'finish', payload: {}, issuedAt: Date.now() });
  await delay(450);

  const finished = await readAppSnapshot();
  assert.equal(finished.snapshot.currentFocusSession, null);
  assert.equal(finished.snapshot.focusLedger.sessions.length, 1);
  assert.equal(finished.snapshot.focusLedger.sessions[0].source, 'stopwatch');
  assert.ok(Number.isFinite(finished.snapshot.focusLedger.sessions[0].pauses[0].endTimestamp));
  assert.equal(finished.stopwatchInput, '');
  assert.equal(await floatingWindow.webContents.executeJavaScript("document.getElementById('session-name').value"), '');
  assert.equal(JSON.stringify(finished.snapshot.taskData), initialTaskData);
  assert.equal(JSON.stringify(finished.snapshot.currentTask), initialCurrentTask);
  assert.deepEqual(runtimeErrors, []);

  return {
    ok: true,
    runningDisplay: running.stopwatchText,
    floatingDisplay: floatingMetrics.time,
    recordedSessions: finished.snapshot.focusLedger.sessions.length,
    taskStateUnchanged: true,
    screenshot: screenshotPath || null
  };
}

function cleanProfileDirectory() {
  const expectedParent = path.resolve(os.tmpdir()).toLowerCase();
  const actualParent = path.resolve(path.dirname(profilePath)).toLowerCase();
  if (actualParent !== expectedParent || !path.basename(profilePath).startsWith('attendance-electron-smoke-')) return;
  try {
    fs.rmSync(profilePath, { recursive: true, force: true });
  } catch (error) {
    // Windows may keep Chromium cache files locked until process teardown; the OS temp folder owns cleanup.
  }
}

app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    const result = await runSmokeTest();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    exitCode = 1;
    process.stderr.write(`${error.stack || error}\n`);
  } finally {
    if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.destroy();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
    await delay(150);
    cleanProfileDirectory();
    app.exit(exitCode);
  }
});
