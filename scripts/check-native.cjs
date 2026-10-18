'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'native', 'bin', 'InkVoice.Input.exe');
function invoke(args, input = '') {
  const child = spawnSync(helper, args, { input, encoding: 'utf8', windowsHide: true, timeout: 12000 });
  if (child.error) throw child.error;
  let result;
  try { result = JSON.parse(child.stdout.trim().replace(/^\uFEFF/, '')); }
  catch { throw new Error(`Helper returned invalid JSON: ${child.stdout} ${child.stderr}`); }
  return { status: child.status, result };
}
function checks() {
  const layout = invoke(['--check']);
  assert.equal(layout.status, 0);
  assert.equal(layout.result.ok, true);
  assert.equal(layout.result.architecture, 'x64');
  assert.equal(layout.result.pointerSize, 8);
  assert.equal(layout.result.inputSize, 40);
  assert.equal(layout.result.keyboardInputSize, 24);
  assert.equal(layout.result.inputUnionOffset, 8);
  assert.equal(layout.result.injectionAttempted, false);
  const rejected = ['0', '-1', 'invalid', '18446744073709551616'].map(target => {
    const check = invoke(['--insert', '--target', target], '不得写入 any app');
    assert.equal(check.status, 2);
    assert.equal(check.result.ok, false);
    assert.equal(check.result.reason, 'invalid-target');
    return { target, ...check };
  });
  const notAWindow = invoke(['--insert', '--target', '1'], '不得写入 any app');
  assert.equal(notAWindow.status, 2);
  assert.equal(notAWindow.result.ok, false);
  assert.equal(notAWindow.result.reason, 'invalid-target');
  const evidence = { kind: 'layout-and-refusal-checks', createdAt: new Date().toISOString(), actualInputVerified: false, layout, rejected, notAWindow };
  fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'evidence', 'native-check.json'), JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}
if (require.main === module) {
  const result = checks();
  console.log(JSON.stringify({ ok: true, kind: result.kind, actualInputVerified: false, invalidTargetsRejected: result.rejected.length + 1 }));
}
module.exports = { checks, invoke };
