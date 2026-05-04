const path = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  Tray
} = require('electron');

const APP_TITLE = '研究生工位打卡与时间管理系统';
const APP_USER_MODEL_ID = 'com.rqzhang017.graduate-workstation-attendance';
const ENTRY_HTML = path.join(__dirname, '..', '研究生工位打卡与时间管理系统.html');
const ICON_PATH = path.join(__dirname, 'icon.png');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let activeFocusReminder = null;

function getTrayIcon() {
  const image = nativeImage.createFromPath(ICON_PATH);
  return image.resize({ width: 16, height: 16 });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 980,
    minHeight: 720,
    title: APP_TITLE,
    show: false,
    backgroundColor: '#edf4ff',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(ENTRY_HTML);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    updateTrayMenu();
  });
}

function showMainWindow() {
  if (!mainWindow) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function bringReminderToFront() {
  if (!mainWindow) return;

  showMainWindow();
  mainWindow.flashFrame(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  setTimeout(() => {
    if (!mainWindow || !activeFocusReminder || activeFocusReminder.acknowledged) return;
    mainWindow.setAlwaysOnTop(false);
  }, 12000);
}

function showSystemNotification(title, body) {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title,
    body,
    silent: false,
    timeoutType: 'never'
  });

  notification.on('click', () => {
    showMainWindow();
    bringReminderToFront();
  });

  notification.show();
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function clearActiveFocusReminder(options = {}) {
  if (!activeFocusReminder) return;

  if (activeFocusReminder.timer) {
    clearTimeout(activeFocusReminder.timer);
  }

  if (activeFocusReminder.repeatTimer) {
    clearInterval(activeFocusReminder.repeatTimer);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.flashFrame(false);
    mainWindow.setAlwaysOnTop(false);
  }

  const acknowledgedSessionId = activeFocusReminder.id;
  activeFocusReminder = null;
  updateTrayMenu();

  if (options.notifyRenderer) {
    sendToRenderer('focus-reminder:acknowledged', { sessionId: acknowledgedSessionId });
  }
}

function fireFocusReminder() {
  if (!activeFocusReminder || activeFocusReminder.acknowledged) return;

  const payload = {
    sessionId: activeFocusReminder.id,
    plannedMinutes: activeFocusReminder.plannedMinutes,
    endTimestamp: activeFocusReminder.endTimestamp,
    title: '专注完成',
    message: '本次专注计时已完成，请休息一下。'
  };

  showSystemNotification(payload.title, payload.message);
  bringReminderToFront();
  sendToRenderer('focus-reminder:due', payload);

  if (!activeFocusReminder.repeatTimer) {
    activeFocusReminder.repeatTimer = setInterval(() => {
      if (!activeFocusReminder || activeFocusReminder.acknowledged) return;
      showSystemNotification(payload.title, `${payload.message} 点击主窗口中的“我知道了”结束提醒。`);
      bringReminderToFront();
    }, 60000);
  }

  updateTrayMenu();
}

function scheduleFocusReminder(session) {
  if (!session || !session.id || !Number.isFinite(session.endTimestamp)) {
    return { ok: false, reason: 'invalid-session' };
  }

  clearActiveFocusReminder();

  const remainingMs = Math.max(0, session.endTimestamp - Date.now());
  activeFocusReminder = {
    id: session.id,
    plannedMinutes: session.plannedMinutes || 0,
    endTimestamp: session.endTimestamp,
    acknowledged: false,
    timer: setTimeout(fireFocusReminder, remainingMs),
    repeatTimer: null
  };

  updateTrayMenu();
  return { ok: true, dueInMs: remainingMs };
}

function acknowledgeFocusReminder(sessionId) {
  if (!activeFocusReminder) {
    return { ok: true, reason: 'no-active-reminder' };
  }

  if (sessionId && activeFocusReminder.id !== sessionId) {
    return { ok: false, reason: 'session-mismatch' };
  }

  activeFocusReminder.acknowledged = true;
  clearActiveFocusReminder({ notifyRenderer: true });
  return { ok: true };
}

function updateTrayMenu() {
  if (!tray) return;

  const reminderLabel = activeFocusReminder
    ? `专注提醒：${new Date(activeFocusReminder.endTimestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : '专注提醒：未运行';

  tray.setToolTip(activeFocusReminder ? `${APP_TITLE} - ${reminderLabel}` : APP_TITLE);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主界面', click: showMainWindow },
    { label: reminderLabel, enabled: false },
    {
      label: '确认当前专注提醒',
      enabled: Boolean(activeFocusReminder),
      click: () => acknowledgeFocusReminder(activeFocusReminder && activeFocusReminder.id)
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.on('click', showMainWindow);
  updateTrayMenu();
}

function registerIpcHandlers() {
  ipcMain.handle('focus-reminder:schedule', (_event, session) => scheduleFocusReminder(session));
  ipcMain.handle('focus-reminder:cancel', (_event, payload = {}) => {
    if (!activeFocusReminder) return { ok: true };
    if (payload.sessionId && activeFocusReminder.id !== payload.sessionId) {
      return { ok: false, reason: 'session-mismatch' };
    }
    clearActiveFocusReminder();
    return { ok: true };
  });
  ipcMain.handle('focus-reminder:acknowledge', (_event, payload = {}) => acknowledgeFocusReminder(payload.sessionId));
  ipcMain.handle('window:show', () => {
    showMainWindow();
    return { ok: true };
  });
}

app.setName(APP_TITLE);
app.setAppUserModelId(APP_USER_MODEL_ID);

app.whenReady().then(() => {
  registerIpcHandlers();
  createMainWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      showMainWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  clearActiveFocusReminder();
});

app.on('window-all-closed', () => {});
