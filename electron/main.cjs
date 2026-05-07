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
const CHECKIN_SNOOZE_MS = 5 * 60 * 1000;

let mainWindow = null;
let tray = null;
let isQuitting = false;
let activeFocusReminder = null;
let activeRestReminder = null;
let activeSedentaryReminder = null;
let currentCheckinReminderDate = null;
const checkinReminderStates = new Map();
const ignoredCheckinReminderIds = new Set();

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

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function navigateToSection(sectionId) {
  showMainWindow();
  sendToRenderer('desktop:navigate', { sectionId });
}

function hasActiveAttentionReminder() {
  if (activeFocusReminder && activeFocusReminder.isFired) return true;
  if (activeRestReminder && activeRestReminder.isFired) return true;
  if (activeSedentaryReminder && activeSedentaryReminder.isFired) return true;
  return Array.from(checkinReminderStates.values()).some(state => state.isFired);
}

function releaseAttentionIfIdle() {
  if (!mainWindow || mainWindow.isDestroyed() || hasActiveAttentionReminder()) return;
  mainWindow.flashFrame(false);
  mainWindow.setAlwaysOnTop(false);
}

function flashMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.flashFrame(true);
}

function bringReminderToFront(sectionId) {
  if (!mainWindow) return;

  if (sectionId) {
    navigateToSection(sectionId);
  } else {
    showMainWindow();
  }

  mainWindow.flashFrame(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setAlwaysOnTop(false);
  }, 12000);
}

function normalizeNotificationActions(actions = []) {
  return actions.map(action => ({
    type: 'button',
    text: action.text
  }));
}

function getActionId(actions, details, deprecatedActionIndex) {
  const actionIndex = Number.isInteger(details && details.actionIndex)
    ? details.actionIndex
    : deprecatedActionIndex;
  return actions[actionIndex] && actions[actionIndex].id;
}

function showSystemNotification(options) {
  if (!Notification.isSupported()) {
    return null;
  }

  const actions = Array.isArray(options.actions) ? options.actions : [];
  let notification = null;

  try {
    notification = new Notification({
      title: options.title,
      body: options.body,
      silent: false,
      timeoutType: options.timeoutType || 'never',
      actions: normalizeNotificationActions(actions)
    });
  } catch (error) {
    console.warn('带按钮的系统通知创建失败，已退回普通通知。', error);
    notification = new Notification({
      title: options.title,
      body: options.body,
      silent: false,
      timeoutType: options.timeoutType || 'never'
    });
  }

  notification.on('click', () => {
    if (typeof options.onClick === 'function') {
      options.onClick();
    }
  });

  notification.on('action', (event, deprecatedActionIndex) => {
    const actionId = getActionId(actions, event, deprecatedActionIndex);
    if (actionId && typeof options.onAction === 'function') {
      options.onAction(actionId);
    }
  });

  notification.show();
  return notification;
}

function clearReminderTimers(reminder) {
  if (!reminder) return;

  if (reminder.timer) {
    clearTimeout(reminder.timer);
  }
}

function clearActiveFocusReminder(options = {}) {
  if (!activeFocusReminder) return;

  clearReminderTimers(activeFocusReminder);
  const acknowledgedSessionId = activeFocusReminder.id;
  activeFocusReminder = null;
  updateTrayMenu();
  releaseAttentionIfIdle();

  if (options.notifyRenderer) {
    sendToRenderer('focus-reminder:acknowledged', { sessionId: acknowledgedSessionId });
  }
}

function handleFocusNotificationAction(actionId) {
  if (actionId === 'ack') {
    acknowledgeFocusReminder(activeFocusReminder && activeFocusReminder.id);
    return;
  }

  bringReminderToFront('focus-section');
}

function showFocusNotification(payload) {
  showSystemNotification({
    title: payload.title,
    body: payload.message,
    actions: [
      { id: 'open', text: '打开' },
      { id: 'ack', text: '我知道了' }
    ],
    onClick: () => handleFocusNotificationAction('open'),
    onAction: handleFocusNotificationAction
  });
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

  activeFocusReminder.isFired = true;
  showFocusNotification(payload);
  bringReminderToFront('focus-section');
  sendToRenderer('focus-reminder:due', payload);

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
    isFired: false,
    timer: setTimeout(fireFocusReminder, remainingMs)
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

function clearActiveRestReminder(options = {}) {
  if (!activeRestReminder) return;

  clearReminderTimers(activeRestReminder);
  const acknowledgedSessionId = activeRestReminder.id;
  activeRestReminder = null;
  updateTrayMenu();
  releaseAttentionIfIdle();

  if (options.notifyRenderer) {
    sendToRenderer('rest-reminder:acknowledged', { sessionId: acknowledgedSessionId });
  }
}

function handleRestNotificationAction(actionId) {
  if (actionId === 'ack') {
    acknowledgeRestReminder(activeRestReminder && activeRestReminder.id);
    return;
  }

  if (actionId === 'snooze') {
    const sessionId = activeRestReminder && activeRestReminder.id;
    clearActiveRestReminder();
    sendToRenderer('rest-reminder:snooze', { sessionId, minutes: 5 });
    bringReminderToFront('rest-section');
    return;
  }

  bringReminderToFront('rest-section');
}

function showRestNotification(payload) {
  showSystemNotification({
    title: payload.title,
    body: payload.message,
    actions: [
      { id: 'open', text: '打开' },
      { id: 'snooze', text: '再休息5分钟' },
      { id: 'ack', text: '回到学习' }
    ],
    onClick: () => handleRestNotificationAction('open'),
    onAction: handleRestNotificationAction
  });
}

function fireRestReminder() {
  if (!activeRestReminder || activeRestReminder.acknowledged) return;

  const payload = {
    sessionId: activeRestReminder.id,
    plannedMinutes: activeRestReminder.plannedMinutes,
    endTimestamp: activeRestReminder.endTimestamp,
    title: '休息结束',
    message: '休息时间结束，该回到学习状态了。'
  };

  activeRestReminder.isFired = true;
  showRestNotification(payload);
  bringReminderToFront('rest-section');
  sendToRenderer('rest-reminder:due', payload);

  updateTrayMenu();
}

function scheduleRestReminder(session) {
  if (!session || !session.id || !Number.isFinite(session.endTimestamp)) {
    return { ok: false, reason: 'invalid-session' };
  }

  clearActiveRestReminder();

  if (session.isPaused) {
    updateTrayMenu();
    return { ok: true, reason: 'paused' };
  }

  const remainingMs = Math.max(0, session.endTimestamp - Date.now());
  activeRestReminder = {
    id: session.id,
    plannedMinutes: session.plannedMinutes || 0,
    endTimestamp: session.endTimestamp,
    acknowledged: false,
    isFired: false,
    timer: setTimeout(fireRestReminder, remainingMs)
  };

  updateTrayMenu();
  return { ok: true, dueInMs: remainingMs };
}

function acknowledgeRestReminder(sessionId) {
  if (!activeRestReminder) {
    return { ok: true, reason: 'no-active-reminder' };
  }

  if (sessionId && activeRestReminder.id !== sessionId) {
    return { ok: false, reason: 'session-mismatch' };
  }

  activeRestReminder.acknowledged = true;
  clearActiveRestReminder({ notifyRenderer: true });
  return { ok: true };
}

function getSedentaryPayload() {
  if (!activeSedentaryReminder) return null;

  if (activeSedentaryReminder.phase === 'sit') {
    return {
      sessionId: activeSedentaryReminder.id,
      phase: activeSedentaryReminder.phase,
      cycleCount: activeSedentaryReminder.cycleCount,
      endTimestamp: activeSedentaryReminder.endTimestamp,
      title: '久坐提醒',
      message: '坐下 45 分钟已完成，请现在起身活动 5 分钟。'
    };
  }

  return {
    sessionId: activeSedentaryReminder.id,
    phase: activeSedentaryReminder.phase,
    cycleCount: activeSedentaryReminder.cycleCount,
    endTimestamp: activeSedentaryReminder.endTimestamp,
    title: '站立完成',
    message: '本轮站立 5 分钟已完成，可以开始下一轮坐下计时。'
  };
}

function clearActiveSedentaryReminder(options = {}) {
  if (!activeSedentaryReminder) return;

  clearReminderTimers(activeSedentaryReminder);
  const acknowledgedSessionId = activeSedentaryReminder.id;
  activeSedentaryReminder = null;
  updateTrayMenu();
  releaseAttentionIfIdle();

  if (options.notifyRenderer) {
    sendToRenderer('sedentary-reminder:acknowledged', { sessionId: acknowledgedSessionId });
  }
}

function handleSedentaryNotificationAction(actionId) {
  if (actionId === 'ack') {
    acknowledgeSedentaryReminder(activeSedentaryReminder && activeSedentaryReminder.id);
    return;
  }

  bringReminderToFront('sedentary-section');
}

function showSedentaryNotification(payload) {
  showSystemNotification({
    title: payload.title,
    body: payload.message,
    actions: [
      { id: 'open', text: '打开' },
      { id: 'ack', text: '我知道了' }
    ],
    onClick: () => handleSedentaryNotificationAction('open'),
    onAction: handleSedentaryNotificationAction
  });
}

function fireSedentaryReminder() {
  if (!activeSedentaryReminder || activeSedentaryReminder.acknowledged) return;

  const payload = getSedentaryPayload();
  if (!payload) return;

  activeSedentaryReminder.isFired = true;
  showSedentaryNotification(payload);
  bringReminderToFront('sedentary-section');
  sendToRenderer('sedentary-reminder:due', payload);

  updateTrayMenu();
}

function scheduleSedentaryReminder(session) {
  if (!session || !session.id || !Number.isFinite(session.endTimestamp)) {
    return { ok: false, reason: 'invalid-session' };
  }

  clearActiveSedentaryReminder();

  if (session.isPaused) {
    updateTrayMenu();
    return { ok: true, reason: 'paused' };
  }

  const remainingMs = Math.max(0, session.endTimestamp - Date.now());
  activeSedentaryReminder = {
    id: session.id,
    phase: session.phase,
    cycleCount: session.cycleCount || 1,
    endTimestamp: session.endTimestamp,
    acknowledged: false,
    isFired: false,
    timer: setTimeout(fireSedentaryReminder, remainingMs)
  };

  updateTrayMenu();
  return { ok: true, dueInMs: remainingMs };
}

function acknowledgeSedentaryReminder(sessionId) {
  if (!activeSedentaryReminder) {
    return { ok: true, reason: 'no-active-reminder' };
  }

  if (sessionId && activeSedentaryReminder.id !== sessionId) {
    return { ok: false, reason: 'session-mismatch' };
  }

  activeSedentaryReminder.acknowledged = true;
  clearActiveSedentaryReminder({ notifyRenderer: true });
  return { ok: true };
}

function clearCheckinReminder(id, options = {}) {
  const state = checkinReminderStates.get(id);
  if (!state) return;

  clearReminderTimers(state);
  checkinReminderStates.delete(id);

  if (options.ignore) {
    ignoredCheckinReminderIds.add(id);
  }

  updateTrayMenu();
  releaseAttentionIfIdle();
}

function clearAllCheckinReminders() {
  Array.from(checkinReminderStates.keys()).forEach(id => clearCheckinReminder(id));
}

function handleCheckinNotificationAction(actionId, reminderId) {
  const state = checkinReminderStates.get(reminderId);
  if (!state) return;

  if (actionId === 'snooze') {
    const snoozedUntil = Date.now() + CHECKIN_SNOOZE_MS;
    const nextPayload = {
      ...state.payload,
      targetTimestamp: snoozedUntil
    };
    clearCheckinReminder(reminderId);
    scheduleCheckinReminder(nextPayload, { snoozedUntil });
    return;
  }

  if (actionId === 'dismiss') {
    clearCheckinReminder(reminderId, { ignore: true });
    return;
  }

  navigateToSection('checkin-section');
}

function showCheckinNotification(state) {
  const payload = state.payload;
  showSystemNotification({
    title: payload.title || '打卡提醒',
    body: payload.message,
    actions: [
      { id: 'open', text: '去打卡' },
      { id: 'snooze', text: '5分钟后' },
      { id: 'dismiss', text: '忽略本次' }
    ],
    onClick: () => handleCheckinNotificationAction('open', payload.id),
    onAction: actionId => handleCheckinNotificationAction(actionId, payload.id)
  });
}

function fireCheckinReminder(id) {
  const state = checkinReminderStates.get(id);
  if (!state || ignoredCheckinReminderIds.has(id)) return;

  state.isFired = true;
  state.snoozedUntil = null;
  showCheckinNotification(state);
  flashMainWindow();

  updateTrayMenu();
}

function scheduleCheckinReminder(reminder, options = {}) {
  if (!reminder || !reminder.id || !Number.isFinite(reminder.targetTimestamp)) return;
  if (ignoredCheckinReminderIds.has(reminder.id)) return;

  clearCheckinReminder(reminder.id);
  const remainingMs = Math.max(0, reminder.targetTimestamp - Date.now());

  checkinReminderStates.set(reminder.id, {
    payload: reminder,
    targetTimestamp: reminder.targetTimestamp,
    snoozedUntil: options.snoozedUntil || null,
    isFired: false,
    timer: setTimeout(() => fireCheckinReminder(reminder.id), remainingMs)
  });
}

function syncCheckinReminders(payload = {}) {
  const date = payload.date || null;
  const reminders = Array.isArray(payload.reminders) ? payload.reminders : [];

  if (date && date !== currentCheckinReminderDate) {
    currentCheckinReminderDate = date;
    ignoredCheckinReminderIds.clear();
  }

  const incomingIds = new Set(reminders.map(reminder => reminder.id).filter(Boolean));
  Array.from(checkinReminderStates.keys()).forEach(id => {
    if (!incomingIds.has(id)) {
      clearCheckinReminder(id);
    }
  });

  reminders.forEach(reminder => {
    if (!reminder || !reminder.id || ignoredCheckinReminderIds.has(reminder.id)) return;

    const existing = checkinReminderStates.get(reminder.id);
    if (existing && existing.snoozedUntil && existing.snoozedUntil > Date.now()) {
      existing.payload = {
        ...reminder,
        targetTimestamp: existing.targetTimestamp
      };
      return;
    }

    if (existing && existing.isFired) {
      existing.payload = reminder;
      return;
    }

    if (existing && existing.targetTimestamp === reminder.targetTimestamp) {
      existing.payload = reminder;
      return;
    }

    scheduleCheckinReminder(reminder);
  });

  updateTrayMenu();
  return { ok: true, count: checkinReminderStates.size };
}

function getReminderTimeLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const focusLabel = activeFocusReminder
    ? `专注提醒：${getReminderTimeLabel(activeFocusReminder.endTimestamp)}`
    : '专注提醒：未运行';

  const restLabel = activeRestReminder
    ? `休息提醒：${getReminderTimeLabel(activeRestReminder.endTimestamp)}`
    : '休息提醒：未运行';

  const sedentaryLabel = activeSedentaryReminder
    ? `久坐提醒：${getReminderTimeLabel(activeSedentaryReminder.endTimestamp)}`
    : '久坐提醒：未运行';

  const activeCheckinCount = Array.from(checkinReminderStates.values()).filter(state => state.isFired).length;
  const checkinLabel = activeCheckinCount > 0
    ? `打卡提醒：${activeCheckinCount} 个待处理`
    : `打卡提醒：已调度 ${checkinReminderStates.size} 个`;

  tray.setToolTip(`${APP_TITLE} - ${focusLabel}，${restLabel}，${sedentaryLabel}，${checkinLabel}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主界面', click: showMainWindow },
    { type: 'separator' },
    { label: focusLabel, enabled: false },
    {
      label: '确认当前专注提醒',
      enabled: Boolean(activeFocusReminder),
      click: () => acknowledgeFocusReminder(activeFocusReminder && activeFocusReminder.id)
    },
    { type: 'separator' },
    { label: restLabel, enabled: false },
    {
      label: '确认当前休息提醒',
      enabled: Boolean(activeRestReminder),
      click: () => acknowledgeRestReminder(activeRestReminder && activeRestReminder.id)
    },
    { type: 'separator' },
    { label: sedentaryLabel, enabled: false },
    {
      label: '确认当前久坐提醒',
      enabled: Boolean(activeSedentaryReminder),
      click: () => acknowledgeSedentaryReminder(activeSedentaryReminder && activeSedentaryReminder.id)
    },
    { type: 'separator' },
    { label: checkinLabel, enabled: false },
    {
      label: '清除当前打卡提醒',
      enabled: activeCheckinCount > 0,
      click: clearAllCheckinReminders
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

  ipcMain.handle('rest-reminder:schedule', (_event, session) => scheduleRestReminder(session));
  ipcMain.handle('rest-reminder:cancel', (_event, payload = {}) => {
    if (!activeRestReminder) return { ok: true };
    if (payload.sessionId && activeRestReminder.id !== payload.sessionId) {
      return { ok: false, reason: 'session-mismatch' };
    }
    clearActiveRestReminder();
    return { ok: true };
  });
  ipcMain.handle('rest-reminder:acknowledge', (_event, payload = {}) => acknowledgeRestReminder(payload.sessionId));

  ipcMain.handle('sedentary-reminder:schedule', (_event, session) => scheduleSedentaryReminder(session));
  ipcMain.handle('sedentary-reminder:cancel', (_event, payload = {}) => {
    if (!activeSedentaryReminder) return { ok: true };
    if (payload.sessionId && activeSedentaryReminder.id !== payload.sessionId) {
      return { ok: false, reason: 'session-mismatch' };
    }
    clearActiveSedentaryReminder();
    return { ok: true };
  });
  ipcMain.handle('sedentary-reminder:acknowledge', (_event, payload = {}) => acknowledgeSedentaryReminder(payload.sessionId));

  ipcMain.handle('checkin-reminder:sync', (_event, payload = {}) => syncCheckinReminders(payload));
  ipcMain.handle('checkin-reminder:clear', () => {
    clearAllCheckinReminders();
    return { ok: true };
  });

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
  clearActiveRestReminder();
  clearActiveSedentaryReminder();
  clearAllCheckinReminders();
});

app.on('window-all-closed', () => {});
