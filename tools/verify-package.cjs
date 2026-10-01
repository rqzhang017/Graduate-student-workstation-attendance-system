const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const archivePath = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'app.asar');
const installerPath = path.join(ROOT, 'dist', `${sourcePackage.build.productName} Setup ${sourcePackage.version}.exe`);
const entryName = '研究生工位打卡与时间管理系统.html';

assert.ok(fs.existsSync(archivePath), `缺少打包归档：${archivePath}`);
assert.ok(fs.existsSync(installerPath), `缺少安装包：${installerPath}`);

const packagedFiles = new Set(
  asar.listPackage(archivePath).map(file => file.replace(/^[/\\]+/, '').replace(/\\/g, '/'))
);
const requiredFiles = [
  'package.json',
  entryName,
  'assets/app.js',
  'assets/focus-ledger.js',
  'electron/main.cjs',
  'electron/preload.cjs',
  'electron/floating.html',
  'electron/floating.js'
];

const missingFiles = requiredFiles.filter(file => !packagedFiles.has(file));
assert.deepEqual(missingFiles, [], `app.asar 缺少文件：${missingFiles.join(', ')}`);

function readPackagedText(file) {
  return asar.extractFile(archivePath, file).toString('utf8');
}

const packagedPackage = JSON.parse(readPackagedText('package.json'));
const packagedHtml = readPackagedText(entryName);
const packagedMain = readPackagedText('electron/main.cjs');
const packagedFloating = readPackagedText('electron/floating.js');
const exactSourceFiles = requiredFiles.filter(file => file !== 'package.json');

exactSourceFiles.forEach(file => {
  const sourceBytes = fs.readFileSync(path.join(ROOT, ...file.split('/')));
  const packagedBytes = asar.extractFile(archivePath, file);
  assert.equal(Buffer.compare(sourceBytes, packagedBytes), 0, `打包内容不是当前源码：${file}`);
});

assert.equal(packagedPackage.version, sourcePackage.version);
assert.ok(packagedHtml.indexOf('assets/focus-ledger.js') < packagedHtml.indexOf('assets/app.js'));
assert.match(packagedMain, /requestSingleInstanceLock/);
assert.ok(
  packagedMain.indexOf('app.setName(APP_TITLE)') < packagedMain.indexOf('app.requestSingleInstanceLock()'),
  '打包主进程必须先固定应用名称，再申请单实例锁'
);
assert.ok(
  packagedMain.indexOf("app.setPath('userData', compatibleUserDataPath)")
    < packagedMain.indexOf('app.requestSingleInstanceLock()'),
  '打包主进程必须先固定兼容 userData 路径，再申请单实例锁'
);
assert.match(packagedMain, /path\.join\(app\.getPath\('appData'\), APP_TITLE\)/);
assert.match(packagedMain, /floating-window:show/);
assert.match(packagedMain, /focus-control:publish-state/);
assert.match(packagedFloating, /sendFocusCommand/);
assert.doesNotMatch(packagedFloating, /localStorage/);

const archiveStat = fs.statSync(archivePath);
const installerStat = fs.statSync(installerPath);
assert.ok(archiveStat.size > 100000, 'app.asar 体积异常');
assert.ok(installerStat.size > 1000000, '安装包体积异常');

process.stdout.write(`${JSON.stringify({
  ok: true,
  version: packagedPackage.version,
  archivePath,
  archiveBytes: archiveStat.size,
  packagedFileCount: packagedFiles.size,
  installerPath,
  installerBytes: installerStat.size,
  requiredFilesVerified: requiredFiles,
  exactSourceFilesVerified: exactSourceFiles
}, null, 2)}\n`);
