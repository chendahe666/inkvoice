'use strict';
// Synthetic checks of our own Electron window controller. These do not launch
// Electron or prove that a real Windows desktop can display / focus a window.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const services = require('../src/services.cjs');
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src', 'main.cjs');
const source = fs.readFileSync(sourcePath, 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
const intersection = (a, b) => Math.max(0, Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)) * Math.max(0, Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));

function harness(name, { lock = true, smoke = false } = {}) {
  const operations = [], windows = [], files = new Map(), handlers = new Map(), timers = new Map();
  let timerId = 0, readyResolve;
  const readyPromise = new Promise(resolve => { readyResolve = resolve; });
  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    { id: 2, workArea: { x: -1280, y: 0, width: 1280, height: 1024 }, bounds: { x: -1280, y: 0, width: 1280, height: 1024 } }
  ];
  function operation(win, method, value) { operations.push({ id: win.id, main: win.isMain, method, ...(value === undefined ? {} : { value: clone(value) }) }); }
  class FakeWebContents extends EventEmitter {
    constructor() { super(); this.session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }; }
    setWindowOpenHandler() {}
    send() {}
    isDestroyed() { return false; }
  }
  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.id = windows.length + 1; this.options = options; this.isMain = options.frame !== false;
      this.destroyed = false; this.visible = Boolean(options.show); this.minimized = false; this.focused = false;
      this.bounds = { x: 160, y: 80, width: options.width || 800, height: options.height || 600 };
      this.webContents = new FakeWebContents(); windows.push(this); operation(this, 'construct', { show: options.show });
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    isMaximized() { return false; }
    isFullScreen() { return false; }
    isFocused() { return this.focused; }
    getBounds() { return { ...this.bounds }; }
    getNormalBounds() { return this.getBounds(); }
    getPosition() { return [this.bounds.x, this.bounds.y]; }
    getSize() { return [this.bounds.width, this.bounds.height]; }
    setBounds(bounds) { this.bounds = { ...this.bounds, ...bounds }; operation(this, 'setBounds', bounds); }
    setPosition(x, y) { this.bounds.x = x; this.bounds.y = y; operation(this, 'setPosition', { x, y }); }
    center() { const a = displays[0].workArea; this.bounds.x = Math.round(a.x+(a.width-this.bounds.width)/2); this.bounds.y = Math.round(a.y+(a.height-this.bounds.height)/2); operation(this, 'center'); }
    show() { if (this.destroyed) throw Error('Attempt to show destroyed window'); this.visible = true; operation(this, 'show'); }
    showInactive() { this.visible = true; operation(this, 'showInactive'); }
    focus() { if (this.destroyed) throw Error('Attempt to focus destroyed window'); this.focused = true; operation(this, 'focus'); }
    restore() { this.minimized = false; this.visible = true; operation(this, 'restore'); }
    hide() { this.visible = false; this.focused = false; operation(this, 'hide'); }
    moveTop() { operation(this, 'moveTop'); }
    setAlwaysOnTop(value) { operation(this, 'setAlwaysOnTop', value); }
    setSkipTaskbar(value) { operation(this, 'setSkipTaskbar', value); }
    setFocusable(value) { operation(this, 'setFocusable', value); }
    setMinimumSize(width, height) { operation(this, 'setMinimumSize', { width, height }); }
    loadFile(file) { operation(this, 'loadFile', { name: path.basename(file) }); return Promise.resolve(); }
    getTitle() { return this.options.title || ''; }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed'); }
  }
  FakeBrowserWindow.getAllWindows = () => windows.filter(win => !win.destroyed);
  FakeBrowserWindow.getFocusedWindow = () => windows.find(win => !win.destroyed && win.focused) || null;
  const app = new EventEmitter();
  app.isPackaged = false; app.ready = false; app.quitCalls = 0; app.exitCodes = [];
  app.commandLine = { appendSwitch() {} }; app.setPath = () => {}; app.setName = () => {};
  app.requestSingleInstanceLock = () => lock;
  app.whenReady = () => readyPromise; app.isReady = () => app.ready;
  app.quit = () => { app.quitCalls++; }; app.exit = code => { app.exitCodes.push(code); };
  app.focus = () => { operations.push({ id: 0, main: false, method: 'app.focus' }); };
  app.getVersion = () => 'synthetic-window-regression'; app.getAppPath = () => root;
  app.getPath = () => path.join(root, 'evidence', 'synthetic-window-data', name);
  const image = { isEmpty: () => false, resize() { return this; } };
  const electron = {
    app, BrowserWindow: FakeBrowserWindow,
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    globalShortcut: { unregisterAll() {}, register: () => true },
    clipboard: { writeText() { throw Error('No clipboard in window mock'); } },
    dialog: { showErrorBox() {}, showMessageBox: async () => ({ response: 0 }) },
    Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} },
    Menu: { buildFromTemplate: value => value },
    nativeImage: { createFromPath: () => image, createFromDataURL: () => image },
    safeStorage: { isEncryptionAvailable: () => false }, shell: {},
    screen: {
      getAllDisplays: () => displays, getPrimaryDisplay: () => displays[0],
      getCursorScreenPoint: () => ({ x: 500, y: 500 }),
      getDisplayNearestPoint: () => displays[0],
      getDisplayMatching: bounds => displays.reduce((a, b) => intersection(bounds, b.workArea) > intersection(bounds, a.workArea) ? b : a)
    }
  };
  const virtualFs = {
    ...fs,
    mkdirSync() {}, existsSync: file => files.has(String(file)),
    writeFileSync(file, value) { files.set(String(file), String(value)); },
    appendFileSync(file, value) { files.set(String(file), (files.get(String(file)) || '') + String(value)); },
    readFileSync(file, encoding) { if (files.has(String(file))) return encoding ? files.get(String(file)) : Buffer.from(files.get(String(file))); return fs.readFileSync(file, encoding); }
  };
  const service = {
    ...services, ensureDir: value => value, readJson: (file, fallback) => fallback, writeJson() {},
    engineStatus: () => ({ ready: true, modelName: 'SYNTHETIC-NO-MODEL', modelBytes: 0 }),
    runProcess: async () => { throw Error('No real native process allowed in window mock'); }
  };
  const context = vm.createContext({
    __dirname: path.dirname(sourcePath), __filename: sourcePath, Buffer, AbortController, console,
    process: { argv: ['synthetic-node', sourcePath, ...(smoke ? ['--smoke-test'] : [])], env: { INKVOICE_DATA_DIR: app.getPath() }, pid: 999999, execPath: process.execPath, platform: 'win32', versions: { electron: 'synthetic' }, on() {} },
    require(id) {
      if (id === 'electron') return electron;
      if (id === 'node:fs') return virtualFs;
      if (id === 'node:path') return path;
      if (id === 'node:crypto') return crypto;
      if (id === './services.cjs') return service;
      throw Error(`Unexpected window-controller require ${id}`);
    },
    setTimeout(callback, milliseconds) { const id = ++timerId; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context, { filename: sourcePath });
  const evaluate = code => vm.runInContext(code, context);
  async function ready() {
    app.ready = true; readyResolve();
    for (let attempt = 0; attempt < 8; attempt++) await turn();
    assert.deepEqual(app.exitCodes, [], 'Mock startup exited unexpectedly');
    assert.ok(evaluate('mainWindow'), 'No main window constructed after app ready');
  }
  return { app, windows, operations, files, displays, evaluate, ready, main: () => evaluate('mainWindow'), mainWindows: () => windows.filter(win => win.isMain), resetOperations() { operations.length = 0; } };
}

const tests = [
  ['second-instance-before-app-ready-defers-windows', async () => {
    const h = harness('second-instance-before-ready');
    h.app.emit('second-instance', {}, ['SYNTHETIC-ARG-MUST-NOT-BE-LOGGED'], '.', {});
    assert.equal(h.windows.length, 0, 'Window construction must wait for app readiness');
    assert.ok(![...h.files.values()].some(value => value.includes('SYNTHETIC-ARG-MUST-NOT-BE-LOGGED')));
    await h.ready(); const main = h.main(); main.emit('ready-to-show');
    assert.equal(main.visible, true);
    return { noPreReadyWindows: true, laterColdStartShows: true, commandLineArgumentNotLogged: true };
  }],
  ['cold-start-ready-to-show-explicitly-reveals-main', async () => {
    const h = harness('cold-start'); await h.ready(); const main = h.main(); h.resetOperations();
    main.visible = false; main.emit('ready-to-show');
    assert.equal(main.visible, true);
    assert.ok(h.operations.some(op => op.id === main.id && op.method === 'show'));
    const hidden = harness('smoke-hidden', { smoke: true });
    hidden.evaluate('createWindows()'); const smokeMain = hidden.main();
    smokeMain.emit('ready-to-show'); hidden.evaluate('showWindow("mock-smoke")');
    assert.equal(smokeMain.options.show, false);
    assert.equal(smokeMain.visible, false);
    assert.equal(hidden.windows.length, 1, 'Smoke must not construct the overlay');
    return { visibleAfterReadyToShow: true, explicitShowCalled: true, smokeModeRemainsHidden: true };
  }],
  ['second-instance-restores-minimized-main', async () => {
    const h = harness('minimized-second-instance'); await h.ready(); const main = h.main(); main.emit('ready-to-show');
    main.visible = false; main.minimized = true; h.resetOperations();
    h.app.emit('second-instance', {}, [], '.', {});
    const methods = h.operations.filter(op => op.id === main.id).map(op => op.method);
    assert.equal(h.main(), main); assert.equal(main.minimized, false); assert.equal(main.visible, true); assert.equal(main.focused, true);
    assert.ok(methods.indexOf('restore') >= 0 && methods.indexOf('restore') < methods.indexOf('show'), 'restore must precede show');
    assert.ok(methods.indexOf('show') < methods.indexOf('focus'), 'show must precede focus');
    assert.equal(h.mainWindows().length, 1);
    return { reusedExistingWindow: true, restoredBeforeShowAndFocus: true };
  }],
  ['second-instance-reuses-hidden-main', async () => {
    const h = harness('hidden-second-instance'); await h.ready(); const main = h.main(); main.emit('ready-to-show');
    main.hide(); h.resetOperations(); h.app.emit('second-instance', {}, [], '.', {});
    assert.equal(h.main(), main); assert.equal(main.visible, true); assert.equal(main.focused, true); assert.equal(h.mainWindows().length, 1);
    return { reusedExistingWindow: true, shownAndFocused: true };
  }],
  ['offscreen-main-returned-to-a-display', async () => {
    const h = harness('offscreen-main'); await h.ready(); const main = h.main(); main.emit('ready-to-show');
    main.bounds.x = 9000; main.bounds.y = 9000; h.resetOperations(); h.app.emit('second-instance', {}, [], '.', {});
    assert.ok(h.displays.some(display => intersection(main.bounds, display.workArea) > 0), 'Main window remains outside all display work areas');
    assert.equal(main.visible, true);
    h.displays[0].workArea = { x: 0, y: 0, width: 800, height: 600 };
    main.bounds.x = 9000; main.bounds.y = 9000; h.app.emit('second-instance', {}, [], '.', {});
    assert.deepEqual(main.bounds, { x: 0, y: 0, width: 800, height: 600 });
    assert.ok(h.operations.some(op => op.id === main.id && op.method === 'setMinimumSize' && op.value.width === 800 && op.value.height === 600));
    return { intersectsDisplayWorkArea: true, shown: true, minimumAndSizeFitSmallWorkArea: true };
  }],
  ['destroyed-main-recreated-on-second-instance', async () => {
    const h = harness('destroyed-main'); await h.ready(); const old = h.main(); old.destroy();
    h.app.emit('second-instance', {}, [], '.', {}); const current = h.main(); current.emit('ready-to-show');
    assert.notEqual(current, old); assert.equal(current.destroyed, false); assert.equal(current.visible, true);
    assert.equal(h.mainWindows().filter(win => !win.destroyed).length, 1);
    return { oneLiveReplacementMainWindow: true, replacementVisible: true };
  }],
  ['stale-ready-event-cannot-show-replacement', async () => {
    const h = harness('stale-window-generation'); await h.ready(); const old = h.main(); old.destroy();
    h.app.emit('second-instance', {}, [], '.', {}); const current = h.main(); current.hide(); h.resetOperations();
    old.emit('ready-to-show');
    assert.equal(current.visible, false, 'An old ready callback revealed the replacement window');
    assert.equal(h.operations.filter(op => ['show', 'focus'].includes(op.method)).length, 0);
    current.emit('ready-to-show'); assert.equal(current.visible, true);
    return { staleGenerationIgnored: true, currentGenerationStillShows: true };
  }],
  ['secondary-process-without-lock-quits-without-windows', async () => {
    const h = harness('no-single-instance-lock', { lock: false });
    assert.equal(h.app.quitCalls, 1); assert.equal(h.windows.length, 0);
    return { quitCalled: true, windowsConstructed: 0 };
  }]
];

async function checks() {
  const cases = [];
  for (const [name, test] of tests) {
    try { cases.push({ name, passed: true, checks: await test() }); }
    catch (error) { cases.push({ name, passed: false, error: error.message, stack: error.stack }); }
  }
  const record = {
    kind: 'synthetic-window-startup-regression', at: new Date().toISOString(), node: process.version,
    appSourceSha256: crypto.createHash('sha256').update(source).digest('hex'), passed: cases.every(item => item.passed), cases,
    actualElectronLaunched: false, actualDesktopVisibilityVerified: false, inheritedEnvironmentUsed: false,
    limitations: [
      'Mocks exercise the trusted InkVoice source startup branch, BrowserWindow events, second-instance callback and window-state decisions.',
      'They cannot prove a visible native window, Windows foreground activation, actual tray behavior, GPU rendering or packaged runtime launch.',
      'No microphone, global shortcut, clipboard, native typing, real ASR, cloud request or inherited credential is used.'
    ]
  };
  fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evidence', 'window-startup-regression.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}
if (require.main === module) checks().then(record => {
  console.log(JSON.stringify({ kind: record.kind, passed: record.passed, passedCases: record.cases.filter(item => item.passed).length, totalCases: record.cases.length, failures: record.cases.filter(item => !item.passed) }, null, 2));
  if (!record.passed) process.exitCode = 1;
}).catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { checks };
