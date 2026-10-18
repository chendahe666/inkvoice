'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const releaseRoot = path.join(root, 'release');
const target = path.join(releaseRoot, 'InkVoice');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const required = [
  'package.json', 'src/main.cjs', 'src/preload.cjs', 'src/renderer.js', 'src/ui.html',
  'src/services.cjs', 'native/bin/InkVoice.Input.exe',
  'runtime/whisper/whisper-cli.exe', 'models/ggml-base-q5_1.bin',
  'THIRD_PARTY_NOTICES.md', 'LICENSE',
];

function abort(message) { console.error(message); process.exit(1); }
if (process.platform !== 'win32') abort('This portable package targets Windows x64. Run packaging on Windows.');
if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) abort('Electron runtime missing. Run npm ci, then node node_modules/electron/install.js.');
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) abort(`Required build input missing: ${relative}`);
}
if (fs.existsSync(target)) {
  abort(`Package destination already exists: ${target}\nClose the running app and move the previous folder elsewhere before packaging again. No existing build was modified.`);
}

fs.mkdirSync(releaseRoot, { recursive: true });
fs.cpSync(electronDist, target, { recursive: true, force: false, errorOnExist: true });
fs.renameSync(path.join(target, 'electron.exe'), path.join(target, 'InkVoice.exe'));
const appRoot = path.join(target, 'resources', 'app');
fs.mkdirSync(appRoot, { recursive: true });
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packagedManifest = {};
for (const key of ['name', 'productName', 'version', 'description', 'main', 'private', 'license']) {
  if (sourcePackage[key] !== undefined) packagedManifest[key] = sourcePackage[key];
}
fs.writeFileSync(path.join(appRoot, 'package.json'), JSON.stringify(packagedManifest, null, 2) + '\n');
for (const relative of ['src', 'native/bin', 'runtime/whisper', 'models', 'THIRD_PARTY_NOTICES.md', 'LICENSE']) {
  const options={recursive:true,force:false,errorOnExist:true};
  if(relative==='runtime/whisper')options.filter=source=>fs.statSync(source).isDirectory()||/^(?:whisper-cli\.exe|whisper\.dll|ggml\.dll|ggml-base\.dll|ggml-cpu-.+\.dll)$/i.test(path.basename(source));
  fs.cpSync(path.join(root, relative), path.join(appRoot, relative), options);
}
// Documentation stays beside the executable. Development data/evidence and API keys are never packaged.
if (fs.existsSync(path.join(root, 'README.md'))) fs.copyFileSync(path.join(root, 'README.md'), path.join(target, 'README.md'));
for (const relative of ['docs', 'SECURITY.md', 'CONTRIBUTING.md', 'THIRD_PARTY_NOTICES.md']) {
  if (fs.existsSync(path.join(root, relative))) fs.cpSync(path.join(root, relative), path.join(target, relative), { recursive: true });
}
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(target, 'LICENSE.inkvoice.txt'));
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push({ path: path.relative(target, full).replaceAll('\\', '/'), bytes: fs.statSync(full).size });
  }
}
walk(target);
const evidence = {
  createdAtUtc: new Date().toISOString(),
  releasePath: target,
  executable: path.join(target, 'InkVoice.exe'),
  version: sourcePackage.version,
  electronVersion: fs.existsSync(path.join(target, 'version')) ? fs.readFileSync(path.join(target, 'version'), 'utf8').trim() : null,
  fileCount: files.length,
  bytes: files.reduce((sum, file) => sum + file.bytes, 0),
  excluded: ['development data', 'test evidence', 'API keys', 'node_modules'],
  electronLicensesRetained: ['LICENSE', 'LICENSES.chromium.html'].every(file => fs.existsSync(path.join(target, file))),
  runtimeAndModelIncluded: true,
  smokeTested: false,
};
fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(root, 'evidence', 'package.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));
