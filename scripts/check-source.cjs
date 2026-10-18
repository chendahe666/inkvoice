'use strict';
// Offline source checks: parse trusted repository files, but never execute the
// application, import its services, inspect user data, or launch dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const slash = value => value.split(path.sep).join('/');
function sourcePath(relative) {
  const absolute = path.resolve(root, relative);
  assert.ok(absolute.startsWith(root + path.sep), `Source path leaves repository: ${relative}`);
  const resolved = fs.realpathSync(absolute);
  assert.ok(resolved.startsWith(fs.realpathSync(root) + path.sep), `Source symlink leaves repository: ${relative}`);
  return absolute;
}
function read(relative) { return fs.readFileSync(sourcePath(relative), 'utf8').replace(/^\uFEFF/, ''); }
function filesBelow(relative) {
  const result = [];
  for (const entry of fs.readdirSync(sourcePath(relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Source check does not follow symlinks: ${slash(child)}`);
    if (entry.isDirectory()) result.push(...filesBelow(child));
    else if (entry.isFile()) result.push(slash(child));
  }
  return result;
}
function captures(text, expression, group = 2) { return [...text.matchAll(expression)].map(match => match[group]); }
function quotedCalls(text, name) {
  return captures(text, new RegExp(`\\b${name}\\(\\s*(['"])([^'"]+)\\1`, 'g'));
}
function htmlIds(html, filename) {
  const all = captures(html, /\bid\s*=\s*(['"])([^'"]+)\1/g);
  assert.equal(new Set(all).size, all.length, `Duplicate HTML id in ${filename}`);
  return new Set(all);
}
function localAsset(parent, reference) {
  assert.ok(!/^(?:[a-z][a-z\d+.-]*:|\/\/|[\\/])/i.test(reference), `Expected local source asset in ${parent}: ${reference}`);
  const relative = slash(path.join(path.dirname(parent), reference.split(/[?#]/, 1)[0]));
  assert.ok(fs.statSync(sourcePath(relative)).isFile(), `Missing local asset ${relative}`);
  return relative;
}

function checks() {
  const passed = [];
  const check = (name, scope, operation) => { operation(); passed.push({ name, scope, passed: true }); };
  let manifest, lock, parsedFiles, rendererMethods = 0, ipcChannels = 0, domReferences = 0;

  check('Source build inputs and package metadata exist', 'Repository files only; generated binaries/models are not required', () => {
    for (const relative of [
      'package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md',
      'src/main.cjs', 'src/services.cjs', 'src/preload.cjs', 'src/overlay-preload.cjs',
      'src/renderer.js', 'src/capture-worklet.js', 'src/ui.html', 'src/ui.css',
      'src/overlay.html', 'src/overlay.js', 'src/icon.png',
      'native/InkVoice.Input.cs', 'scripts/setup-engine.ps1', 'scripts/build-native.ps1', 'scripts/package.cjs'
    ]) assert.ok(fs.statSync(sourcePath(relative)).isFile(), `Missing source build input ${relative}`);
    manifest = JSON.parse(read('package.json')); lock = JSON.parse(read('package-lock.json'));
    assert.ok(typeof manifest.main === 'string' && manifest.main.length > 0, 'Package main is missing');
    assert.ok(fs.statSync(sourcePath(manifest.main)).isFile(), 'Package main does not resolve to source');
    assert.equal(lock.name, manifest.name, 'Package-lock name differs from package.json');
    assert.equal(lock.version, manifest.version, 'Package-lock version differs from package.json');
    assert.equal(lock.packages?.['']?.version, manifest.version, 'Root lock entry version differs');
    assert.deepEqual(lock.packages?.['']?.devDependencies || {}, manifest.devDependencies || {}, 'Locked development dependency declarations differ');
    assert.equal(lock.packages?.['node_modules/electron']?.version, manifest.devDependencies?.electron, 'Electron version is not pinned consistently');
  });

  check('Application and maintenance JavaScript parse', 'Syntax only; no application or script is executed', () => {
    parsedFiles = [...filesBelow('src'), ...filesBelow('scripts')].filter(file => /\.(?:cjs|js)$/.test(file)).sort();
    assert.ok(parsedFiles.length > 0, 'No JavaScript source files found');
    for (const relative of parsedFiles) new vm.Script(read(relative), { filename: relative, displayErrors: true });
  });

  const main = read('src/main.cjs'), preload = read('src/preload.cjs'), renderer = read('src/renderer.js');
  const overlayPreload = read('src/overlay-preload.cjs'), overlay = read('src/overlay.js');
  check('Preload IPC routes have main-process handlers', 'Literal source route contract; does not verify actual Electron IPC delivery', () => {
    const exported = new Set(quotedCalls(preload, 'invoke').filter(name => name.startsWith('inkvoice:')));
    const handled = new Set(quotedCalls(main, 'handle').filter(name => name.startsWith('inkvoice:')));
    assert.ok(exported.size > 0, 'Preload has no static IPC routes');
    for (const channel of exported) assert.ok(handled.has(channel), `Preload route has no handler: ${channel}`);
    ipcChannels = exported.size;
    const published = new Set(captures(main, /(?:\bsend|\.send)\(\s*(['"])(inkvoice:[^'"]+)\1/g));
    const subscribed = [...quotedCalls(preload, 'subscribe'), ...captures(overlayPreload, /ipcRenderer\.on\(\s*(['"])(inkvoice:[^'"]+)\1/g)];
    for (const channel of subscribed) assert.ok(published.has(channel), `Preload subscription has no publisher: ${channel}`);
  });

  check('Renderer bridge calls are exposed by preload', 'Static literal API names only; dynamic behavior is covered by separate mock checks', () => {
    assert.ok(/exposeInMainWorld\(\s*['"]inkvoice['"]\s*,/.test(preload), 'Main renderer bridge is missing');
    assert.ok(/exposeInMainWorld\(\s*['"]inkvoiceOverlay['"]\s*,/.test(overlayPreload), 'Overlay bridge is missing');
    const exposed = new Set(captures(preload, /\b([A-Za-z_$][\w$]*)\s*:\s*/g, 1));
    const methods = new Set([
      ...quotedCalls(renderer, 'call'), ...quotedCalls(renderer, 'invoke'),
      ...captures(renderer, /\bapi\.([A-Za-z_$][\w$]*)\s*\(/g, 1)
    ]);
    for (const method of methods) assert.ok(exposed.has(method), `Renderer method is not exposed: ${method}`);
    rendererMethods = methods.size;
  });

  check('Rendered controls and local page assets resolve', 'Static HTML ids and literal asset references; not a browser layout/accessibility test', () => {
    for (const [htmlFile, scriptFile, shorthand] of [
      ['src/ui.html', 'src/renderer.js', true], ['src/overlay.html', 'src/overlay.js', false]
    ]) {
      const html = read(htmlFile), script = read(scriptFile), ids = htmlIds(html, htmlFile);
      const references = new Set(captures(script, /getElementById\(\s*(['"])([^'"]+)\1\s*\)/g));
      if (shorthand) for (const id of captures(script, /\$\(\s*(['"])([^'"]+)\1\s*\)/g)) references.add(id);
      for (const id of references) assert.ok(ids.has(id), `Missing HTML control ${id} in ${htmlFile}`);
      domReferences += references.size;
      for (const reference of captures(html, /<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/gi)) localAsset(htmlFile, reference);
    }
    assert.ok(overlay.includes('window.inkvoiceOverlay.onState'), 'Overlay state bridge is not used');
  });

  check('Audio worklet file and processor names agree', 'Source wiring only; no microphone, waveform or ASR is exercised', () => {
    for (const reference of captures(renderer, /audioWorklet\.addModule\(\s*(['"])([^'"]+)\1/g)) localAsset('src/renderer.js', reference);
    const processors = new Set(quotedCalls(read('src/capture-worklet.js'), 'registerProcessor'));
    const requested = captures(renderer, /new\s+AudioWorkletNode\s*\([^,]+,\s*(['"])([^'"]+)\1/g);
    assert.ok(requested.length > 0, 'Renderer does not reference an audio processor');
    for (const processor of requested) assert.ok(processors.has(processor), `Audio processor is not registered: ${processor}`);
  });

  return {
    kind: 'offline-source-contract-check', passed: true, checks: passed,
    filesParsed: parsedFiles.length, ipcChannels, rendererMethods, domReferences,
    dependenciesInstalledRequired: false, generatedEvidenceRequired: false, modelRequired: false,
    environmentRead: false, networkUsed: false, applicationExecuted: false,
    limitations: ['Source parsing and wiring contracts only; actual Electron, microphone, native input, speech recognition, cloud service and package installation require separate checks.']
  };
}

if (require.main === module) {
  try { console.log(JSON.stringify(checks(), null, 2)); }
  catch (error) { console.error(JSON.stringify({ kind: 'offline-source-contract-check', passed: false, error: error.message }, null, 2)); process.exitCode = 1; }
}
module.exports = { checks };
