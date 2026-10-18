'use strict';
// Controller-only synthetic regression checks. No Electron, microphone,
// foreground lookup, keyboard input, ASR process, network, or cloud key is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const actualServices = require('../src/services.cjs');

const root = path.resolve(__dirname, '..');
const sourceFile = path.join(root, 'src', 'main.cjs');
const source = fs.readFileSync(sourceFile, 'utf8');
const testDataRoot = path.join(root, 'evidence', 'controller-test-data');
const helperPath = path.join(root, 'native', 'bin', 'InkVoice.Input.exe');
const plain = value => JSON.parse(JSON.stringify(value));
const delayTurn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(predicate, description) {
  for (let turn = 0; turn < 40; turn++) {
    if (predicate()) return;
    await delayTurn();
  }
  throw new Error(`Synthetic controller did not reach: ${description}`);
}
function transcript(text = 'Synthetic controller sample.') {
  return { raw: text, text, durationSeconds: 1, asrMs: 0, language: 'en', engine: 'SYNTHETIC-CONTROLLER-MOCK' };
}
function result(id, text) {
  return { id, text, raw: `raw ${text}`, createdAt: '2026-10-17T00:00:00.000Z', insertion: { status: 'held' } };
}
function harness(name) {
  fs.mkdirSync(testDataRoot, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(testDataRoot, `${name}-`));
  const handlers = new Map();
  const messages = [];
  const calls = { foreground: [], insert: [], transcribe: [], refine: [], dialogs: 0 };
  const controls = {
    foreground: async () => ({ handle: '420', pid: 42, processName: 'synthetic-own-target', title: 'SYNTHETIC controller target' }),
    insert: async () => ({ ok: true, count: 12 }),
    transcribe: async () => transcript(),
    refine: async text => ({ text, polishMs: 0, mode: 'synthetic-polish' }),
    dialog: async () => ({ canceled: true, filePaths: [] })
  };
  let sequence = 0;
  const webContents = { send(channel, payload) { messages.push({ channel, payload: plain(payload) }); } };
  const mainWindow = { webContents, isDestroyed: () => false };
  const service = {
    ...actualServices,
    engineStatus: () => ({ ready: true, modelName: 'SYNTHETIC-NO-MODEL', modelBytes: 0, reason: null }),
    async runProcess(executable, args, options = {}) {
      assert.equal(executable, helperPath);
      if (args[0] === '--foreground') {
        calls.foreground.push({ args: [...args] });
        return { code: 0, stdout: JSON.stringify(await controls.foreground()), stderr: '' };
      }
      assert.equal(args[0], '--insert');
      calls.insert.push({ args: [...args], input: options.input, signal: options.signal });
      return { code: 0, stdout: JSON.stringify(await controls.insert(options)), stderr: '' };
    },
    async transcribeWave(buffer, options) {
      calls.transcribe.push({ signal: options.signal, bufferBytes: buffer.length });
      return controls.transcribe(buffer, options);
    },
    async refineText(text, options) {
      calls.refine.push({ text, signal: options.signal, keyAvailable: Boolean(options.key) });
      return controls.refine(text, options);
    },
    newResult(value) { return { id: `${name}-result-${++sequence}`, createdAt: '2026-10-17T00:00:00.000Z', ...value }; }
  };
  const electron = {
    app: {
      isPackaged: false, setPath() {}, setName() {}, requestSingleInstanceLock: () => false,
      quit() {}, on() {}, commandLine: { appendSwitch() {} }
    },
    ipcMain: { handle(channel, handler) { handlers.set(channel, handler); } },
    globalShortcut: { unregisterAll() {}, register: () => true },
    clipboard: { writeText() { throw new Error('Unexpected real clipboard route in controller checks'); } },
    dialog: { showOpenDialog() { calls.dialogs++; return controls.dialog(); } },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openPath() { throw new Error('Unexpected openPath in controller checks'); } }
  };
  const timers = new Map();
  let timerSequence = 0;
  const context = vm.createContext({
    __dirname: path.dirname(sourceFile), __filename: sourceFile, __mainWindow: mainWindow,
    require(id) {
      if (id === 'electron') return electron;
      if (id === './services.cjs') return service;
      if (id === 'node:fs') return { ...fs, existsSync: file => file === helperPath || fs.existsSync(file) };
      if (id === 'node:path') return path;
      if (id === 'node:crypto') return { randomUUID: () => `${name}-session-${++sequence}` };
      throw new Error(`Unexpected controller require: ${id}`);
    },
    // Deliberately exclude all inherited environment variables and credentials.
    process: { argv: ['synthetic-node', sourceFile], env: { INKVOICE_DATA_DIR: dataDir }, pid: 999999, execPath: process.execPath },
    Buffer, AbortController, console,
    setTimeout(callback, milliseconds) { const id = ++timerSequence; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context, { filename: sourceFile });
  vm.runInContext('mainWindow=__mainWindow;configureIPC();', context);
  function evaluate(code) { return vm.runInContext(code, context); }
  function seed(code, fixture) { context.__fixture = fixture; return evaluate(code); }
  function ipc(channel, ...args) {
    const handler = handlers.get(channel);
    assert.ok(handler, `Missing handler ${channel}`);
    return handler({ sender: webContents }, ...args);
  }
  function view() { return plain(evaluate('({state,history,activeSession,startingRecording,importDialogOpen})')); }
  return { evaluate, seed, ipc, view, controls, calls, messages, dataDir };
}

const tests = [
  ['duplicate-delayed-start', async () => {
    const h = harness('duplicate-start');
    const foreground = deferred();
    h.controls.foreground = () => foreground.promise;
    const first = h.evaluate('beginRecording()');
    const second = h.evaluate('beginRecording()');
    await second;
    assert.equal(h.calls.foreground.length, 1);
    assert.equal(h.view().startingRecording, true);
    foreground.resolve({ handle: '420', pid: 42 });
    await first;
    assert.equal(h.view().state.phase, 'recording');
    assert.ok(h.view().activeSession);
    assert.equal(h.messages.filter(x => x.channel === 'inkvoice:recorder' && x.payload.type === 'start').length, 1);
    h.evaluate('cancel()');
    return { starts: 1, foregroundLookups: 1 };
  }],
  ['import-dialog-reserves-operation', async () => {
    const h = harness('import-reservation');
    const picker = deferred();
    h.controls.dialog = () => picker.promise;
    const importing = h.ipc('inkvoice:import');
    assert.equal(h.view().importDialogOpen, true);
    await h.evaluate('toggleRecording()');
    const duplicate = await h.ipc('inkvoice:import');
    assert.equal(duplicate.ok, false);
    assert.equal(h.calls.dialogs, 1);
    assert.equal(h.calls.foreground.length, 0);
    assert.equal(h.view().activeSession, null);
    picker.resolve({ canceled: true, filePaths: [] });
    assert.equal((await importing).canceled, true);
    assert.equal(h.view().importDialogOpen, false);
    assert.equal(h.calls.transcribe.length, 0);
    return { dialogs: 1, blockedRecordingStarts: true, canceledImportDoesNotTranscribe: true };
  }],
  ['cancel-during-insert-preserves-new-session', async () => {
    const h = harness('cancel-insert');
    const insertion = deferred(), nextAsr = deferred();
    h.controls.insert = () => insertion.promise;
    h.controls.transcribe = () => h.calls.transcribe.length === 1 ? transcript('old synthetic job') : nextAsr.promise;
    h.seed('activeSession={id:"old-session",target:{handle:"420",pid:42}};history=[__fixture];state.result=__fixture;', result('prior', 'prior result'));
    const oldJob = h.evaluate('processAudio(Buffer.from("synthetic old audio"),{sessionId:"old-session",target:activeSession.target})');
    await until(() => h.calls.insert.length === 1, 'old job awaits mocked insert');
    const oldSignal = h.calls.insert[0].signal;
    assert.ok(oldSignal);
    assert.equal(oldSignal.aborted, false);
    h.evaluate('cancel()');
    assert.equal(oldSignal.aborted, true);
    await h.evaluate('beginRecording()');
    const newerJob = h.evaluate('processAudio(Buffer.from("synthetic new audio"),{sessionId:activeSession.id,target:activeSession.target})');
    await until(() => h.calls.transcribe.length === 2, 'new job awaits mocked ASR');
    const expected = h.view();
    const newController = h.evaluate('abortController');
    assert.equal(expected.state.phase, 'transcribing');
    assert.notEqual(expected.activeSession.id, 'old-session');
    // Deliberately let the mocked operation ignore abort and finish late. This
    // verifies the controller's post-await generation check independently.
    insertion.resolve({ ok: true, count: 17 });
    await oldJob;
    assert.deepEqual(h.view(), expected);
    assert.equal(h.evaluate('abortController'), newController);
    assert.equal(newController.signal.aborted, false);
    h.evaluate('cancel()');
    nextAsr.resolve(transcript('new canceled synthetic job'));
    await newerJob;
    assert.equal(h.calls.insert.length, 1);
    return { abortSignalPropagated: true, lateOldCompletionIgnored: true, newerControllerRetained: true };
  }],
  ['paste-after-clear-does-not-recreate-history', async () => {
    const h = harness('paste-cleared');
    h.seed('state={...state,phase:"ready",result:__fixture};history=[__fixture];', result('cleared', 'retained visible result'));
    await h.ipc('inkvoice:clear-history');
    await h.evaluate('pasteLast()');
    assert.equal(h.view().state.result.insertion.status, 'inserted');
    assert.equal(h.view().history.length, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'history.json'), 'utf8')), []);
    return { visibleResultRemainsUsable: true, historyRemainsEmpty: true };
  }],
  ['paste-after-delete-does-not-recreate-history', async () => {
    const h = harness('paste-deleted');
    h.seed('history=__fixture;state={...state,phase:"ready",result:history[1]};', [result('kept', 'kept result'), result('deleted', 'deleted visible result')]);
    await h.ipc('inkvoice:delete-history', 'deleted');
    await h.evaluate('pasteLast()');
    assert.deepEqual(h.view().history.map(x => x.id), ['kept']);
    assert.equal(h.view().state.result.id, 'deleted');
    assert.equal(h.view().state.result.insertion.status, 'inserted');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'history.json'), 'utf8')).map(x => x.id), ['kept']);
    return { deletedRowNotRecreated: true, unrelatedRowPreserved: true };
  }],
  ['selected-draft-updates-correct-result', async () => {
    const h = harness('selected-draft');
    h.seed('history=__fixture;state={...state,phase:"ready",result:history[0]};', [result('first', 'first text'), result('second', 'second text')]);
    assert.equal((await h.ipc('inkvoice:select-result', 'second')).ok, true);
    assert.equal((await h.ipc('inkvoice:update-draft', { id: 'second', text: 'edited selected second text' })).ok, true);
    const view = h.view();
    assert.equal(view.state.result.id, 'second');
    assert.equal(view.state.result.text, 'edited selected second text');
    assert.equal(view.state.result.raw, 'raw second text');
    assert.equal(view.history.find(x => x.id === 'second').text, 'edited selected second text');
    assert.equal(view.history.find(x => x.id === 'second').raw, 'raw second text');
    assert.equal(view.history.find(x => x.id === 'first').text, 'first text');
    assert.equal((await h.ipc('inkvoice:update-draft', { id: 'first', text: 'stale update' })).ok, false);
    assert.deepEqual(h.view(), view);
    return { correctActiveAndHistoryRowEdited: true, rawPreserved: true, staleEditRefused: true };
  }],
  ['retry-polish-respects-start-reservation', async () => {
    const h = harness('retry-during-start');
    h.seed('state={...state,phase:"ready",result:__fixture};history=[__fixture];', result('previous', 'previous editable result'));
    const foreground = deferred();
    h.controls.foreground = () => foreground.promise;
    const starting = h.evaluate('beginRecording()');
    assert.equal(h.view().startingRecording, true);
    assert.equal(h.view().state.phase, 'ready');
    const before = h.view();
    assert.equal((await h.ipc('inkvoice:retry-polish')).ok, false);
    assert.deepEqual(h.view(), before);
    assert.equal(h.calls.refine.length, 0);
    foreground.resolve({ handle: '420', pid: 42 });
    await starting;
    assert.equal(h.view().state.phase, 'recording');
    h.evaluate('cancel()');
    return { reservedStartRejectsRetry: true, refineCallsDuringReservation: 0 };
  }],
  ['retry-polish-respects-import-reservation', async () => {
    const h = harness('retry-during-import');
    h.seed('state={...state,phase:"ready",result:__fixture};history=[__fixture];', result('previous', 'previous editable result'));
    const picker = deferred();
    h.controls.dialog = () => picker.promise;
    const importing = h.ipc('inkvoice:import');
    assert.equal(h.view().importDialogOpen, true);
    const before = h.view();
    assert.equal((await h.ipc('inkvoice:retry-polish')).ok, false);
    assert.deepEqual(h.view(), before);
    assert.equal(h.calls.refine.length, 0);
    picker.resolve({ canceled: true, filePaths: [] });
    await importing;
    return { fileDialogRejectsRetry: true, refineCallsDuringReservation: 0 };
  }],
  ['retry-polish-uses-edited-final-text', async () => {
    const h = harness('retry-edited-final');
    h.seed('settings={...settings,polishMode:"polish"};state={...state,phase:"ready",result:__fixture};history=[__fixture];', result('edited', 'initial final text'));
    assert.equal((await h.ipc('inkvoice:update-draft', { id: 'edited', text: 'Edited final wording with correction.' })).ok, true);
    const refinement = deferred();
    h.controls.refine = () => refinement.promise;
    const retrying = h.ipc('inkvoice:retry-polish');
    assert.equal(h.view().state.phase, 'polishing');
    assert.equal(h.calls.refine.length, 1);
    assert.equal(h.calls.refine[0].text, 'Edited final wording with correction.');
    assert.equal(h.view().state.result.raw, 'raw initial final text');
    refinement.resolve({ text: 'Polished edited wording.', polishMs: 0, mode: 'synthetic-polish' });
    assert.equal((await retrying).ok, true);
    const view = h.view();
    assert.equal(view.state.phase, 'ready');
    assert.equal(view.state.result.text, 'Polished edited wording.');
    assert.equal(view.state.result.raw, 'raw initial final text');
    assert.equal(view.history[0].text, 'Polished edited wording.');
    assert.equal(view.history[0].raw, 'raw initial final text');
    assert.equal(view.state.result.insertion.status, 'held');
    assert.equal(h.calls.insert.length, 0);
    return { editedFinalTextSentToRefine: true, originalRawPreserved: true, automaticInsertionNotRequested: true };
  }],
  ['busy-draft-edits-are-rejected', async () => {
    const h = harness('busy-draft');
    h.seed('state={...state,phase:"ready",result:__fixture};history=[__fixture];', result('busy-result', 'unchanged user text'));
    const phases = ['recording', 'transcribing', 'polishing'];
    for (const phase of phases) {
      h.seed('state.phase=__fixture;', phase);
      const before = h.view();
      const edit = await h.ipc('inkvoice:update-draft', { id: 'busy-result', text: 'must not replace active result' });
      assert.equal(edit.ok, false, `Edit should be rejected during ${phase}`);
      assert.deepEqual(h.view(), before);
    }
    return { rejectedPhases: phases, activeAndHistoryTextPreserved: true };
  }],
  ['empty-final-draft-stays-empty', async () => {
    const h = harness('empty-draft');
    h.seed('history=__fixture;state={...state,phase:"ready",result:history[0]};', [result('other', 'other text'), result('empty-target', 'nonempty original text')]);
    assert.equal((await h.ipc('inkvoice:select-result', 'empty-target')).ok, true);
    assert.equal((await h.ipc('inkvoice:update-draft', { id: 'empty-target', text: '' })).ok, true);
    assert.equal(h.view().state.result.text, '');
    assert.equal(h.view().state.result.raw, 'raw nonempty original text');
    assert.equal((await h.ipc('inkvoice:select-result', 'other')).ok, true);
    assert.equal((await h.ipc('inkvoice:select-result', 'empty-target')).ok, true);
    const before = h.view();
    assert.equal(before.state.result.text, '');
    assert.equal(before.history.find(item => item.id === 'empty-target').text, '');
    assert.equal((await h.ipc('inkvoice:retry-polish')).ok, false);
    await h.evaluate('pasteLast()');
    assert.deepEqual(h.view(), before);
    assert.equal(h.calls.refine.length, 0);
    assert.equal(h.calls.foreground.length, 0);
    assert.equal(h.calls.insert.length, 0);
    return { emptyFinalPreservedAcrossSelection: true, originalRawPreserved: true, emptyRetryRefused: true, emptyPasteDoesNotInsertRaw: true };
  }],
  ['partial-native-insert-is-not-full-retry', async () => {
    const h = harness('partial-input');
    h.controls.insert = async () => ({ ok: false, count: 5, reason: 'focus-changed' });
    const insertion = await h.evaluate('insertText("synthetic sample",{handle:"420",pid:42})');
    assert.equal(insertion.status, 'partial');
    assert.equal(insertion.insertedUnits, 5);
    assert.equal(insertion.reason, 'focus-changed');
    assert.ok(/部分/.test(insertion.message));
    assert.ok(!/重试|retry/i.test(insertion.message));
    return { partialUnitsReported: 5, duplicateInsertionWarning: /重复/.test(insertion.message) };
  }],
  ['cloud-failure-retains-raw-without-insertion', async () => {
    const h = harness('cloud-failure');
    h.controls.transcribe = async () => ({ ...transcript('synthetic raw kept verbatim'), text: 'synthetic cleaned text' });
    h.controls.refine = async () => { throw new Error('Synthetic cloud failure'); };
    h.evaluate('settings={...settings,polishMode:"polish",autoInsert:true};activeSession={id:"cloud-session",target:{handle:"420",pid:42}};');
    await h.evaluate('processAudio(Buffer.from("synthetic audio"),{sessionId:"cloud-session",target:activeSession.target})');
    const view = h.view();
    assert.equal(view.state.phase, 'ready');
    assert.equal(view.state.result.raw, 'synthetic raw kept verbatim');
    assert.equal(view.state.result.text, 'synthetic cleaned text');
    assert.equal(view.state.result.warning, 'Synthetic cloud failure');
    assert.equal(view.state.result.insertion.status, 'held');
    assert.equal(view.history[0].raw, 'synthetic raw kept verbatim');
    assert.equal(h.calls.insert.length, 0);
    assert.equal(h.calls.refine.length, 1);
    assert.equal(h.calls.refine[0].keyAvailable, false);
    return { rawPreserved: true, cleanedTextRetained: true, warningShown: true, nativeInsertCalls: 0, realCredentialAvailable: false };
  }]
];

async function checks() {
  const cases = [];
  for (const [name, run] of tests) {
    try { cases.push({ name, passed: true, checks: await run() }); }
    catch (error) { cases.push({ name, passed: false, error: error.message, stack: error.stack }); }
  }
  const record = {
    kind: 'synthetic-controller-mock-regression', at: new Date().toISOString(), node: process.version,
    appSource: 'src/main.cjs', appSourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
    passed: cases.every(test => test.passed), cases,
    scope: 'Trusted independent InkVoice controller loaded in a Node VM with mocked Electron lifecycle, IPC sender, engine status, native process, ASR and cloud dependencies.',
    actualMicrophoneUsed: false, actualNativeInputUsed: false, actualForegroundLookupUsed: false,
    actualAsrUsed: false, actualCloudUsed: false, inheritedEnvironmentUsed: false,
    limitations: [
      'Synthetic controller checks verify state transitions, concurrency guards and result/history behavior only.',
      'No microphone, global keyboard shortcut, native input, real foreground app, ASR recognition quality or cloud response is verified here.',
      'Mock insertion deliberately ignores abort to exercise the post-await stale-job guard; real child-process termination is outside this test.',
      'Synthetic history/settings are isolated below evidence/controller-test-data and never mixed with real transcription evidence.'
    ]
  };
  fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evidence', 'controller-regression_smoke.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}
if (require.main === module) checks().then(record => {
  console.log(JSON.stringify({ kind: record.kind, passed: record.passed, passedCases: record.cases.filter(x => x.passed).length, totalCases: record.cases.length, failures: record.cases.filter(x => !x.passed) }, null, 2));
  if (!record.passed) process.exitCode = 1;
}).catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { checks };
