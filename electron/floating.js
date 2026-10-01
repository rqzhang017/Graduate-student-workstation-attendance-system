'use strict';

const desktop = window.attendanceDesktop;
const elements = {
  body: document.body,
  statusDot: document.getElementById('status-dot'),
  compactStatus: document.getElementById('compact-status'),
  collapseWindow: document.getElementById('collapse-window'),
  hideWindow: document.getElementById('hide-window'),
  idleView: document.getElementById('idle-view'),
  stopwatchView: document.getElementById('stopwatch-view'),
  countdownView: document.getElementById('countdown-view'),
  sessionName: document.getElementById('session-name'),
  startSession: document.getElementById('start-session'),
  stopwatchTime: document.getElementById('stopwatch-time'),
  stopwatchTitle: document.getElementById('stopwatch-title'),
  pauseSession: document.getElementById('pause-session'),
  resumeSession: document.getElementById('resume-session'),
  finishSession: document.getElementById('finish-session'),
  countdownTime: document.getElementById('countdown-time'),
  openMain: document.getElementById('open-main'),
  notice: document.getElementById('notice')
};

let focusState = {
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
let isCollapsed = false;
let localNotice = '';
let localNoticeTimer = null;
let commandPending = false;

function formatClock(durationMs, roundUp = false) {
  const safeMs = Math.max(0, Number(durationMs) || 0);
  const totalSeconds = roundUp ? Math.ceil(safeMs / 1000) : Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function projectDurations() {
  const stateAge = Math.max(0, Date.now() - Number(focusState.updatedAt || Date.now()));
  const isRunning = focusState.active && focusState.status === 'running';
  return {
    elapsedMs: Math.max(0, Number(focusState.elapsedMs || 0) + (isRunning && focusState.mode === 'stopwatch' ? stateAge : 0)),
    remainingMs: Math.max(0, Number(focusState.remainingMs || 0) - (isRunning && focusState.mode === 'countdown' ? stateAge : 0))
  };
}

function showOnly(view) {
  [elements.idleView, elements.stopwatchView, elements.countdownView].forEach(element => {
    element.classList.toggle('visible', element === view);
  });
}

function setLocalNotice(message) {
  localNotice = String(message || '');
  clearTimeout(localNoticeTimer);
  if (localNotice) {
    localNoticeTimer = setTimeout(() => {
      localNotice = '';
      render();
    }, 4000);
  }
  render();
}

function setCommandPending(pending) {
  commandPending = Boolean(pending);
  [elements.startSession, elements.pauseSession, elements.resumeSession, elements.finishSession]
    .forEach(button => { button.disabled = commandPending; });
}

function render() {
  const projected = projectDurations();
  const isStopwatch = focusState.active && focusState.mode === 'stopwatch';
  const isCountdown = focusState.active && focusState.mode === 'countdown';
  const isPaused = isStopwatch && focusState.status === 'paused';
  const isWarning = isStopwatch && (focusState.overLong || projected.elapsedMs >= 12 * 60 * 60 * 1000);

  elements.body.classList.toggle('collapsed', isCollapsed);
  elements.body.classList.toggle('warning', isWarning);
  elements.collapseWindow.textContent = isCollapsed ? '+' : '−';
  elements.collapseWindow.title = isCollapsed ? '展开悬浮窗' : '折叠悬浮窗';
  elements.collapseWindow.setAttribute('aria-label', elements.collapseWindow.title);

  elements.statusDot.className = 'status-dot';
  if (isCountdown) elements.statusDot.classList.add('countdown');
  if (isStopwatch && !isPaused) elements.statusDot.classList.add('running');
  if (isPaused) elements.statusDot.classList.add('paused');

  if (isStopwatch) {
    const clock = formatClock(projected.elapsedMs);
    const title = focusState.title || '无标题专注';
    elements.compactStatus.textContent = `${isWarning ? '⚠ ' : ''}${isPaused ? '已暂停' : clock} · ${title}`;
    elements.stopwatchTime.textContent = clock;
    elements.stopwatchTitle.textContent = `${isPaused ? '已暂停 · ' : ''}${title}${isWarning ? ' · 已超过12小时' : ''}`;
    elements.pauseSession.hidden = isPaused;
    elements.resumeSession.hidden = !isPaused;
    showOnly(elements.stopwatchView);
  } else if (isCountdown) {
    const clock = formatClock(projected.remainingMs, true);
    elements.compactStatus.textContent = `倒计时 · ${clock}`;
    elements.countdownTime.textContent = `剩余 ${clock}`;
    showOnly(elements.countdownView);
  } else {
    elements.compactStatus.textContent = '未开始';
    showOnly(elements.idleView);
  }

  elements.notice.textContent = localNotice || focusState.notice || '';
}

async function sendCommand(action, payload = {}) {
  if (!desktop || typeof desktop.sendFocusCommand !== 'function' || commandPending) return;
  setCommandPending(true);
  try {
    const result = await desktop.sendFocusCommand(action, payload);
    if (!result || result.ok === false) {
      setLocalNotice(result && result.reason ? `操作失败：${result.reason}` : '操作暂时失败，请重试。');
    }
  } catch (error) {
    setLocalNotice('主应用暂时不可用，请稍后重试。');
  } finally {
    setCommandPending(false);
  }
}

async function initialize() {
  if (!desktop || !desktop.isAvailable) {
    setLocalNotice('当前环境不支持桌面悬浮控制。');
    elements.startSession.disabled = true;
    return;
  }

  desktop.onFocusControlState(state => {
    const previousWasStopwatch = focusState.active && focusState.mode === 'stopwatch';
    focusState = { ...focusState, ...(state || {}) };
    if (focusState.active && focusState.mode === 'stopwatch') {
      elements.sessionName.value = focusState.title || '';
    } else if (previousWasStopwatch) {
      elements.sessionName.value = '';
    }
    render();
  });

  try {
    const [settings, state] = await Promise.all([
      desktop.getDesktopSettings(),
      desktop.requestFocusState()
    ]);
    isCollapsed = Boolean(settings && settings.floatingCollapsed);
    focusState = { ...focusState, ...(state || {}) };
  } catch (error) {
    setLocalNotice('悬浮窗状态读取失败，正在等待主应用同步。');
  }

  render();
}

elements.startSession.addEventListener('click', () => {
  sendCommand('start', { title: elements.sessionName.value.trim() });
});

elements.sessionName.addEventListener('keydown', event => {
  if (event.key === 'Enter') sendCommand('start', { title: elements.sessionName.value.trim() });
});

elements.pauseSession.addEventListener('click', () => sendCommand('pause'));
elements.resumeSession.addEventListener('click', () => sendCommand('resume'));
elements.finishSession.addEventListener('click', () => sendCommand('finish'));
elements.openMain.addEventListener('click', () => desktop.showMainWindow('focus-section'));

elements.collapseWindow.addEventListener('click', async () => {
  isCollapsed = !isCollapsed;
  render();
  try {
    const result = await desktop.setFloatingCollapsed(isCollapsed);
    if (result && typeof result.collapsed === 'boolean') isCollapsed = result.collapsed;
  } catch (error) {
    isCollapsed = !isCollapsed;
    setLocalNotice('折叠状态保存失败。');
  }
  render();
});

elements.hideWindow.addEventListener('click', () => desktop.hideFloatingWindow());

setInterval(render, 250);
initialize();
