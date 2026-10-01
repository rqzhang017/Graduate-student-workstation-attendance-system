const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const mainHtml = fs.readFileSync(path.join(ROOT, '研究生工位打卡与时间管理系统.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'electron', 'main.cjs'), 'utf8');
const preloadJs = fs.readFileSync(path.join(ROOT, 'electron', 'preload.cjs'), 'utf8');
const floatingHtml = fs.readFileSync(path.join(ROOT, 'electron', 'floating.html'), 'utf8');
const floatingJs = fs.readFileSync(path.join(ROOT, 'electron', 'floating.js'), 'utf8');

function collectMatches(text, pattern, captureIndex = 1) {
  return [...text.matchAll(pattern)].map(match => match[captureIndex]);
}

function collectHtmlIds(html) {
  return new Set(collectMatches(html, /\bid=(['"])([^'"]+)\1/g, 2));
}

test('主页面在业务脚本前加载统一专注账本', () => {
  const ledgerIndex = mainHtml.indexOf('assets/focus-ledger.js');
  const appIndex = mainHtml.indexOf('assets/app.js');
  assert.ok(ledgerIndex >= 0, '主页面缺少 focus-ledger.js');
  assert.ok(appIndex > ledgerIndex, 'app.js 必须在 focus-ledger.js 之后加载');
});

test('app.js 的静态 DOM 引用都能在主页面找到', () => {
  const htmlIds = collectHtmlIds(mainHtml);
  const referencedIds = new Set(collectMatches(appJs, /getElement\(\s*['"]([^'"]+)['"]\s*\)/g));
  const missing = [...referencedIds].filter(id => !htmlIds.has(id)).sort();
  assert.deepEqual(missing, []);
});

test('floating.js 的 DOM 引用都能在悬浮页找到', () => {
  const htmlIds = collectHtmlIds(floatingHtml);
  const referencedIds = new Set(collectMatches(floatingJs, /document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g));
  const missing = [...referencedIds].filter(id => !htmlIds.has(id)).sort();
  assert.deepEqual(missing, []);
});

test('preload 暴露的 invoke 通道在主进程全部有 handler', () => {
  const invoked = new Set(collectMatches(preloadJs, /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/g));
  const handled = new Set(collectMatches(mainJs, /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g));
  const missing = [...invoked].filter(channel => !handled.has(channel)).sort();
  assert.deepEqual(missing, []);
});

test('悬浮页保持单向 IPC，不直接访问专注 localStorage', () => {
  assert.equal(/localStorage/.test(floatingJs), false);
  assert.match(floatingJs, /sendFocusCommand/);
  assert.match(floatingJs, /onFocusControlState/);
});

test('应用身份在单实例锁前初始化，保持旧版用户数据目录兼容', () => {
  const setNameIndex = mainJs.indexOf('app.setName(APP_TITLE)');
  const setAppUserModelIdIndex = mainJs.indexOf('app.setAppUserModelId(APP_USER_MODEL_ID)');
  const setUserDataPathIndex = mainJs.indexOf("app.setPath('userData', compatibleUserDataPath)");
  const singleInstanceLockIndex = mainJs.indexOf('app.requestSingleInstanceLock()');

  assert.ok(setNameIndex >= 0, '主进程必须设置稳定的应用名称');
  assert.ok(setAppUserModelIdIndex >= 0, '主进程必须设置稳定的 AppUserModelId');
  assert.match(mainJs, /path\.join\(app\.getPath\('appData'\), APP_TITLE\)/);
  assert.ok(setUserDataPathIndex >= 0, '主进程必须显式固定兼容的 userData 路径');
  assert.ok(singleInstanceLockIndex >= 0, '主进程必须申请单实例锁');
  assert.ok(setNameIndex < singleInstanceLockIndex, '必须先设置应用名称，再申请单实例锁');
  assert.ok(setAppUserModelIdIndex < singleInstanceLockIndex, '必须先设置 AppUserModelId，再申请单实例锁');
  assert.ok(setUserDataPathIndex < singleInstanceLockIndex, '必须先固定 userData 路径，再申请单实例锁');
});
