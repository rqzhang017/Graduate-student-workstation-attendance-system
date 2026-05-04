const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  if (typeof callback !== 'function') {
    return () => {};
  }

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('attendanceDesktop', {
  isAvailable: true,
  scheduleFocusReminder(session) {
    return ipcRenderer.invoke('focus-reminder:schedule', session);
  },
  cancelFocusReminder(sessionId) {
    return ipcRenderer.invoke('focus-reminder:cancel', { sessionId });
  },
  acknowledgeFocusReminder(sessionId) {
    return ipcRenderer.invoke('focus-reminder:acknowledge', { sessionId });
  },
  showMainWindow() {
    return ipcRenderer.invoke('window:show');
  },
  onFocusReminderDue(callback) {
    return on('focus-reminder:due', callback);
  },
  onFocusReminderAcknowledged(callback) {
    return on('focus-reminder:acknowledged', callback);
  }
});
