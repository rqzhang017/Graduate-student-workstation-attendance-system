const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  Tray
} = require('electron');

const APP_TITLE = '研究生工位打卡与时间管理系统';
const APP_USER_MODEL_ID = 'com.rqzhang017.graduate-workstation-attendance';
const ENTRY_HTML = path.join(__dirname, '..', '研究生工位打卡与时间管理系统.html');
const FLOATING_HTML = path.join(__dirname, 'floating.html');
const ICON_PATH = path.join(__dirname, 'icon.png');
const CHECKIN_SNOOZE_MS = 5 * 60 * 1000;
const HIDDEN_LAUNCH_ARG = '--focus-floating-only';
const DEFAULT_FLOATING_WIDTH = 360;
const DEFAULT_FLOATING_HEIGHT = 150;
const COLLAPSED_FLOATING_HEIGHT = 56;
const isHiddenLaunch = process.argv.includes(HIDDEN_LAUNCH_ARG);

// Electron derives the default userData directory from app.name. Keep this
// before requestSingleInstanceLock() and pin the path explicitly so upgrades
// continue reading the 1.1.x profile instead of creating a package-name profile.
app.setName(APP_TITLE);
app.setAppUserModelId(APP_USER_MODEL_ID);
const compatibleUserDataPath = path.join(app.getPath('appData'), APP_TITLE);
fs.mkdirSync(compatibleUserDataPath, { recursive: true });
app.setPath('userData', compatibleUserDataPath);
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow = null;
let floatingWindow = null;
let tray = null;
let isQuitting = false;
let mainRendererReady = false;
let pendingFocusCommands = [];
let pendingNavigationSection = null;
let desktopSettings = null;
let floatingBoundsSaveTimer = null;
let lastFocusTraySignature = '';
let shortcutRegistrationStatus = { ok: true, message: '' };
let latestFocusState = {
  active: false,
  mode: 'countdown',
  status: 'idle',
  title: '',
  elapsedMs: 0,
  remainingMs: 0,
  overLong: false,
  notice: '',
  updatedAt: Date.now()
};
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

function getDefaultDesktopSettings() {
  return {
    version: 1,
    autoLaunch: true,
    shortcutEnabled: true,
    shortcut: 'Ctrl+Alt+T',
    floatingCollapsed: false,
    floatingBounds: null
  };
}

function getDesktopSettingsPath() {
  return path.join(app.getPath('userData'), 'desktop-settings.json');
}

function loadDesktopSettings() {
  const defaults = getDefaultDesktopSettings();
  try {
    const stored = JSON.parse(fs.readFileSync(getDesktopSettingsPath(), 'utf8'));
    desktopSettings = {
      ...defaults,
      ...(stored && typeof stored === 'object' ? stored : {})
    };
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.warn('桌面设置读取失败，已使用默认值。', error);
    }
    desktopSettings = defaults;
  }

  desktopSettings.autoLaunch = desktopSettings.autoLaunch !== false;
  desktopSettings.shortcutEnabled = desktopSettings.shortcutEnabled !== false;
  desktopSettings.shortcut = typeof desktopSettings.shortcut === 'string' && desktopSettings.shortcut.trim()
    ? desktopSettings.shortcut.trim().slice(0, 80)
    : defaults.shortcut;
  desktopSettings.floatingCollapsed = Boolean(desktopSettings.floatingCollapsed);
  if (!desktopSettings.floatingBounds
    || !Number.isFinite(optionalFiniteNumber(desktopSettings.floatingBounds.x, NaN))
    || !Number.isFinite(optionalFiniteNumber(desktopSettings.floatingBounds.y, NaN))) {
    desktopSettings.floatingBounds = null;
  } else {
    desktopSettings.floatingBounds = {
      x: Math.round(Number(desktopSettings.floatingBounds.x)),
      y: Math.round(Number(desktopSettings.floatingBounds.y))
    };
  }
  return desktopSettings;
}

function getPublicDesktopSettings() {
  if (!desktopSettings) loadDesktopSettings();
  return {
    autoLaunch: desktopSettings.autoLaunch !== false,
    shortcutEnabled: desktopSettings.shortcutEnabled !== false,
    shortcut: desktopSettings.shortcut,
    floatingCollapsed: Boolean(desktopSettings.floatingCollapsed),
    shortcutStatus: { ...shortcutRegistrationStatus }
  };
}

function optionalFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function saveDesktopSettings() {
  if (!desktopSettings) return;
  try {
    const settingsPath = getDesktopSettingsPath();
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const temporaryPath = `${settingsPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(desktopSettings, null, 2), 'utf8');
    fs.renameSync(temporaryPath, settingsPath);
  } catch (error) {
    console.warn('桌面设置保存失败。', error);
  }
}

function applyAutoLaunchSetting() {
  if (process.platform !== 'win32' || !app.isPackaged || !desktopSettings) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: desktopSettings.autoLaunch !== false,
      args: [HIDDEN_LAUNCH_ARG]
    });
  } catch (error) {
    console.warn('Windows 开机自启设置失败。', error);
  }
}

function toggleFloatingWindow() {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    createFloatingWindow();
    return;
  }
  if (floatingWindow.isVisible()) {
    floatingWindow.hide();
  } else {
    floatingWindow.showInactive();
  }
  updateTrayMenu();
}

function registerFloatingShortcut(settings = desktopSettings) {
  globalShortcut.unregisterAll();
  if (!settings || settings.shortcutEnabled === false) return { ok: true };
  const shortcut = typeof settings.shortcut === 'string' ? settings.shortcut.trim() : '';
  if (!shortcut) {
    return { ok: false, message: '快捷键不能为空；如不需要快捷键，请关闭快捷键开关。' };
  }
  try {
    const registered = globalShortcut.register(shortcut, toggleFloatingWindow);
    if (!registered) {
      return { ok: false, message: `快捷键 ${shortcut} 已被其他程序占用，请换一个组合。` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: '快捷键格式无效，请使用类似 Ctrl+Alt+T 的组合。' };
  }
}

function updateDesktopSettings(nextSettings = {}) {
  if (!desktopSettings) loadDesktopSettings();
  const previousSettings = { ...desktopSettings };
  const candidate = {
    ...desktopSettings,
    autoLaunch: Object.prototype.hasOwnProperty.call(nextSettings, 'autoLaunch')
      ? Boolean(nextSettings.autoLaunch)
      : desktopSettings.autoLaunch,
    shortcutEnabled: Object.prototype.hasOwnProperty.call(nextSettings, 'shortcutEnabled')
      ? Boolean(nextSettings.shortcutEnabled)
      : desktopSettings.shortcutEnabled,
    shortcut: Object.prototype.hasOwnProperty.call(nextSettings, 'shortcut')
      ? String(nextSettings.shortcut || '').trim().slice(0, 80)
      : desktopSettings.shortcut
  };

  const registration = registerFloatingShortcut(candidate);
  if (!registration.ok) {
    registerFloatingShortcut(previousSettings);
    shortcutRegistrationStatus = registration;
    return {
      ok: false,
      message: registration.message,
      settings: getPublicDesktopSettings()
    };
  }

  desktopSettings = candidate;
  shortcutRegistrationStatus = { ok: true, message: '' };
  saveDesktopSettings();
  applyAutoLaunchSetting();
  updateTrayMenu();
  return { ok: true, settings: getPublicDesktopSettings() };
}

function isSavedFloatingPositionVisible(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  return screen.getAllDisplays().some(display => {
    const area = display.workArea;
    return bounds.x < area.x + area.width - 40
      && bounds.x + DEFAULT_FLOATING_WIDTH > area.x + 40
      && bounds.y < area.y + area.height - 30
      && bounds.y + COLLAPSED_FLOATING_HEIGHT > area.y + 30;
  });
}

function getInitialFloatingBounds() {
  const saved = desktopSettings && desktopSettings.floatingBounds;
  const height = desktopSettings && desktopSettings.floatingCollapsed
    ? COLLAPSED_FLOATING_HEIGHT
    : DEFAULT_FLOATING_HEIGHT;
  if (isSavedFloatingPositionVisible(saved)) {
    return { x: Math.round(saved.x), y: Math.round(saved.y), width: DEFAULT_FLOATING_WIDTH, height };
  }
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: area.x + area.width - DEFAULT_FLOATING_WIDTH - 24,
    y: area.y + 24,
    width: DEFAULT_FLOATING_WIDTH,
    height
  };
}

function scheduleFloatingBoundsSave() {
  clearTimeout(floatingBoundsSaveTimer);
  floatingBoundsSaveTimer = setTimeout(() => {
    floatingBoundsSaveTimer = null;
    saveFloatingBoundsNow();
  }, 250);
}

function saveFloatingBoundsNow() {
  if (!floatingWindow || floatingWindow.isDestroyed() || !desktopSettings) return;
  const bounds = floatingWindow.getBounds();
  desktopSettings.floatingBounds = { x: bounds.x, y: bounds.y };
  saveDesktopSettings();
}

function sendToFloating(channel, payload) {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;
  floatingWindow.webContents.send(channel, payload);
}

function showFloatingWindow() {
  if (!floatingWindow || floatingWindow.isDestroyed()) {
    createFloatingWindow();
    return;
  }
  floatingWindow.showInactive();
  updateTrayMenu();
}

function setFloatingCollapsed(collapsed) {
  if (!desktopSettings) loadDesktopSettings();
  desktopSettings.floatingCollapsed = Boolean(collapsed);
  saveDesktopSettings();
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    const bounds = floatingWindow.getBounds();
    const height = desktopSettings.floatingCollapsed ? COLLAPSED_FLOATING_HEIGHT : DEFAULT_FLOATING_HEIGHT;
    floatingWindow.setBounds({ x: bounds.x, y: bounds.y, width: DEFAULT_FLOATING_WIDTH, height }, true);
  }
  return { ok: true, collapsed: desktopSettings.floatingCollapsed };
}

function createFloatingWindow() {
  if (floatingWindow && !floatingWindow.isDestroyed()) return floatingWindow;
  const bounds = getInitialFloatingBounds();
  floatingWindow = new BrowserWindow({
    ...bounds,
    minWidth: DEFAULT_FLOATING_WIDTH,
    maxWidth: DEFAULT_FLOATING_WIDTH,
    minHeight: COLLAPSED_FLOATING_HEIGHT,
    maxHeight: DEFAULT_FLOATING_HEIGHT,
    title: '专注正计时',
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#f8fbff',
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  floatingWindow.setAlwaysOnTop(true, 'floating');
  floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  floatingWindow.loadFile(FLOATING_HTML);
  floatingWindow.once('ready-to-show', () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.showInactive();
      updateTrayMenu();
    }
  });
  floatingWindow.webContents.on('did-finish-load', () => {
    sendToFloating('focus-control:state', latestFocusState);
  });
  floatingWindow.on('move', scheduleFloatingBoundsSave);
  floatingWindow.on('close', event => {
    if (isQuitting) return;
    event.preventDefault();
    floatingWindow.hide();
    updateTrayMenu();
  });
  floatingWindow.on('closed', () => {
    floatingWindow = null;
  });
  return floatingWindow;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
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
      sandbox: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(ENTRY_HTML);

  mainWindow.webContents.on('did-start-loading', () => {
    mainRendererReady = false;
  });

  mainWindow.webContents.on('render-process-gone', () => {
    mainRendererReady = false;
  });

  mainWindow.once('ready-to-show', () => {
    if (!isHiddenLaunch) mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    updateTrayMenu();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    mainRendererReady = false;
  });

  return mainWindow;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    const createdWindow = createMainWindow();
    createdWindow.once('ready-to-show', () => {
      if (createdWindow && !createdWindow.isDestroyed()) {
        createdWindow.show();
        createdWindow.focus();
      }
    });
    return;
  }

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

function isMainRendererSender(event) {
  return Boolean(
    event
    && mainWindow
    && !mainWindow.isDestroyed()
    && !mainWindow.webContents.isDestroyed()
    && event.sender.id === mainWindow.webContents.id
  );
}

function sanitizeFocusState(rawState = {}) {
  const mode = rawState.mode === 'stopwatch' ? 'stopwatch' : 'countdown';
  const allowedStatuses = new Set(['idle', 'running', 'paused']);
  return {
    active: Boolean(rawState.active),
    id: typeof rawState.id === 'string' ? rawState.id.slice(0, 160) : null,
    mode,
    status: allowedStatuses.has(rawState.status) ? rawState.status : (rawState.active ? 'running' : 'idle'),
    title: typeof rawState.title === 'string' ? rawState.title.slice(0, 120) : '',
    plannedMinutes: optionalFiniteNumber(rawState.plannedMinutes),
    startTimestamp: optionalFiniteNumber(rawState.startTimestamp),
    elapsedMs: Math.max(0, Number(rawState.elapsedMs) || 0),
    remainingMs: Math.max(0, Number(rawState.remainingMs) || 0),
    overLong: Boolean(rawState.overLong),
    notice: typeof rawState.notice === 'string' ? rawState.notice.slice(0, 180) : '',
    updatedAt: optionalFiniteNumber(rawState.updatedAt, Date.now())
  };
}

function getFocusStateTraySignature(state) {
  return [
    state.active,
    state.mode,
    state.status,
    state.title,
    state.overLong,
    Math.floor((state.mode === 'countdown' ? state.remainingMs : state.elapsedMs) / 60000),
    Boolean(floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible())
  ].join('|');
}

function publishFocusState(rawState) {
  latestFocusState = sanitizeFocusState(rawState);
  sendToFloating('focus-control:state', latestFocusState);
  const signature = getFocusStateTraySignature(latestFocusState);
  if (signature !== lastFocusTraySignature) {
    lastFocusTraySignature = signature;
    updateTrayMenu();
  }
  return { ok: true };
}

function dispatchFocusControlCommand(action, payload = {}) {
  const allowedActions = new Set(['start', 'pause', 'resume', 'finish', 'abandon', 'request-state']);
  if (!allowedActions.has(action)) return { ok: false, reason: 'invalid-action' };
  const command = {
    action,
    payload: {
      title: typeof payload.title === 'string' ? payload.title.slice(0, 120) : ''
    },
    issuedAt: Date.now()
  };

  if (!mainRendererReady || !mainWindow || mainWindow.webContents.isDestroyed()) {
    pendingFocusCommands.push(command);
    pendingFocusCommands = pendingFocusCommands.slice(-20);
    return { ok: true, queued: true };
  }
  sendToRenderer('focus-control:command', command);
  return { ok: true, queued: false };
}

function markFocusRendererReady() {
  mainRendererReady = true;
  if (pendingNavigationSection) {
    sendToRenderer('desktop:navigate', { sectionId: pendingNavigationSection });
    pendingNavigationSection = null;
  }
  const queued = pendingFocusCommands.splice(0);
  queued.forEach(command => sendToRenderer('focus-control:command', command));
  sendToRenderer('focus-control:command', { action: 'request-state', payload: {}, issuedAt: Date.now() });
  return { ok: true, requestState: true, queuedCount: queued.length };
}

function navigateToSection(sectionId) {
  showMainWindow();
  if (!mainRendererReady) {
    pendingNavigationSection = sectionId;
    return;
  }
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

function formatTrayDuration(durationMs) {
  const totalMinutes = Math.max(0, Math.floor(Number(durationMs || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}小时${minutes}分`;
  return `${minutes}分钟`;
}

function getFocusControlTrayLabel() {
  if (!latestFocusState.active) return '专注计时：未运行';
  if (latestFocusState.mode === 'countdown') {
    return `倒计时：剩余 ${formatTrayDuration(latestFocusState.remainingMs)}`;
  }

  const title = latestFocusState.title || '无标题专注';
  const status = latestFocusState.status === 'paused' ? '已暂停' : '进行中';
  const warning = latestFocusState.overLong ? '已超过12小时 · ' : '';
  return `正计时${status}：${warning}${title} · ${formatTrayDuration(latestFocusState.elapsedMs)}`;
}

function updateTrayMenu() {
  if (!tray) return;

  const focusControlLabel = getFocusControlTrayLabel();

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

  const tooltip = `${APP_TITLE} - ${focusControlLabel}；${focusLabel}；${restLabel}；${sedentaryLabel}；${checkinLabel}`;
  tray.setToolTip(tooltip.slice(0, 127));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主界面', click: showMainWindow },
    {
      label: floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible()
        ? '隐藏专注悬浮窗'
        : '显示专注悬浮窗',
      click: toggleFloatingWindow
    },
    { label: focusControlLabel, enabled: false },
    ...(latestFocusState.active && latestFocusState.mode === 'countdown'
      ? [{ label: '打开专注页操作倒计时', click: () => navigateToSection('focus-section') }]
      : []),
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

  ipcMain.handle('floating-window:show', () => {
    showFloatingWindow();
    return { ok: true };
  });
  ipcMain.handle('floating-window:hide', () => {
    if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.hide();
    updateTrayMenu();
    return { ok: true };
  });
  ipcMain.handle('floating-window:set-collapsed', (_event, payload = {}) => {
    return setFloatingCollapsed(Boolean(payload.collapsed));
  });

  ipcMain.handle('desktop-settings:get', () => getPublicDesktopSettings());
  ipcMain.handle('desktop-settings:update', (_event, settings = {}) => updateDesktopSettings(settings));

  ipcMain.handle('focus-control:ready', event => {
    if (!isMainRendererSender(event)) return { ok: false, reason: 'main-renderer-only' };
    return markFocusRendererReady();
  });
  ipcMain.handle('focus-control:publish-state', (event, state = {}) => {
    if (!isMainRendererSender(event)) return { ok: false, reason: 'main-renderer-only' };
    return publishFocusState(state);
  });
  ipcMain.handle('focus-control:get-state', () => ({ ...latestFocusState }));
  ipcMain.handle('focus-control:command', (_event, command = {}) => {
    return dispatchFocusControlCommand(command.action, command.payload);
  });

  ipcMain.handle('window:show', (_event, payload = {}) => {
    if (payload.sectionId === 'focus-section') {
      navigateToSection('focus-section');
    } else {
      showMainWindow();
    }
    return { ok: true };
  });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes(HIDDEN_LAUNCH_ARG)) {
      showFloatingWindow();
    } else {
      showMainWindow();
    }
  });

  app.whenReady().then(() => {
    loadDesktopSettings();
    registerIpcHandlers();
    createMainWindow();
    createFloatingWindow();
    createTray();
    applyAutoLaunchSetting();
    shortcutRegistrationStatus = registerFloatingShortcut(desktopSettings);
    updateTrayMenu();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        createFloatingWindow();
      } else {
        showMainWindow();
      }
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  clearTimeout(floatingBoundsSaveTimer);
  floatingBoundsSaveTimer = null;
  saveFloatingBoundsNow();
  globalShortcut.unregisterAll();
  clearActiveFocusReminder();
  clearActiveRestReminder();
  clearActiveSedentaryReminder();
  clearAllCheckinReminders();
});

app.on('window-all-closed', () => {});
