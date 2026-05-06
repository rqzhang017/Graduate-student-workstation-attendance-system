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
  scheduleSedentaryReminder(session) {
    return ipcRenderer.invoke('sedentary-reminder:schedule', session);
  },
  cancelSedentaryReminder(sessionId) {
    return ipcRenderer.invoke('sedentary-reminder:cancel', { sessionId });
  },
  acknowledgeSedentaryReminder(sessionId) {
    return ipcRenderer.invoke('sedentary-reminder:acknowledge', { sessionId });
  },
  syncCheckinReminders(payload) {
    return ipcRenderer.invoke('checkin-reminder:sync', payload);
  },
  clearCheckinReminders() {
    return ipcRenderer.invoke('checkin-reminder:clear');
  },
  showMainWindow() {
    return ipcRenderer.invoke('window:show');
  },
  onFocusReminderDue(callback) {
    return on('focus-reminder:due', callback);
  },
  onFocusReminderAcknowledged(callback) {
    return on('focus-reminder:acknowledged', callback);
  },
  onSedentaryReminderDue(callback) {
    return on('sedentary-reminder:due', callback);
  },
  onSedentaryReminderAcknowledged(callback) {
    return on('sedentary-reminder:acknowledged', callback);
  },
  onNavigate(callback) {
    return on('desktop:navigate', callback);
  }
});
