'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),manifest=require('../package.json');
if(process.platform!=='linux'||!['x64','arm64'].includes(process.arch))throw Error('Run on Linux x64/arm64');
const dist=process.env.INKVOICE_ELECTRON_DIST||path.join(root,'runtime',`electron-linux-${process.arch}`);
const target=path.join(root,'release',`InkVoice-linux-${process.arch}`);
for(const relative of ['native/linux-input.py','runtime/whisper/whisper-cli','models/ggml-base-q5_1.bin'])if(!fs.existsSync(path.join(root,relative)))throw Error('Required input missing: '+relative);
if(!fs.existsSync(path.join(dist,'electron')))throw Error('Run scripts/setup-electron-linux.sh first');
if(fs.readFileSync(path.join(dist,'version'),'utf8').trim()!==manifest.devDependencies.electron)throw Error('Electron version mismatch');
if(fs.existsSync(target))throw Error('Package destination exists; no files changed');
fs.mkdirSync(path.dirname(target),{recursive:true});fs.cpSync(dist,target,{recursive:true});
fs.renameSync(path.join(target,'electron'),path.join(target,'InkVoice'));
const appRoot=path.join(target,'resources','app');fs.mkdirSync(appRoot,{recursive:true});
fs.writeFileSync(path.join(appRoot,'package.json'),JSON.stringify({name:manifest.name,productName:manifest.productName,version:manifest.version,main:manifest.main,license:manifest.license,desktopName:'org.inkvoice.InkVoice.desktop'},null,2)+'\n');
for(const relative of ['src','native/linux-input.py','runtime/whisper/whisper-cli','models/ggml-base-q5_1.bin','LICENSE','THIRD_PARTY_NOTICES.md']){const dest=path.join(appRoot,relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.cpSync(path.join(root,relative),dest,{recursive:true});}
for(const relative of ['README.md','docs','SECURITY.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md'])if(fs.existsSync(path.join(root,relative)))fs.cpSync(path.join(root,relative),path.join(target,relative),{recursive:true});
fs.copyFileSync(path.join(root,'LICENSE'),path.join(target,'LICENSE.inkvoice.txt'));
fs.writeFileSync(path.join(target,'start-inkvoice.sh'),'#!/usr/bin/env sh\nset -eu\ncd "$(dirname "$0")"\nexec ./InkVoice "$@"\n',{mode:0o755});
// Explicitly invoked per-user installation; no login item or automatic startup.
fs.writeFileSync(path.join(target,'install-desktop-entry.sh'),'#!/usr/bin/env sh\nset -eu\nexec python3 "$(dirname "$0")/install-desktop-entry.py" "$@"\n',{mode:0o755});
fs.writeFileSync(path.join(target,'install-desktop-entry.py'),String.raw`#!/usr/bin/env python3
import os
import pathlib
root = pathlib.Path(__file__).resolve().parent
target = pathlib.Path(os.environ.get("XDG_DATA_HOME", str(pathlib.Path.home()/".local/share")))/"applications/org.inkvoice.InkVoice.desktop"
target.parent.mkdir(parents=True, exist_ok=True)
def desktop_string(value):
    return str(value).replace("\\", "\\\\").replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
def quote_exec(value):
    value = str(value)
    if any(ord(char) < 32 for char in value):
        raise SystemExit("Move InkVoice to a path without control characters before installing its desktop entry.")
    value = "".join("\\"+char if char in ('\\', '"', chr(96), '$') else char for char in value).replace("%", "%%")
    return desktop_string('"'+value+'"')
content = "\n".join(["[Desktop Entry]", "Type=Application", "Name=墨声 InkVoice", "Exec=/bin/sh "+quote_exec(root/"start-inkvoice.sh"), "Icon="+desktop_string(root/"resources/app/src/icon.png"), "Terminal=false", "Categories=Utility;Audio;"])+"\n"
target.write_text(content, encoding="utf-8")
print(target)
`,{mode:0o755});
console.log(JSON.stringify({target,version:manifest.version,arch:process.arch,includesUserData:false,smokeTested:false}));
