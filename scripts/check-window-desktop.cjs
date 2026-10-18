'use strict';
// Own Electron windows only: no microphone, keyboard input, clipboard or cloud calls.
const {app,BrowserWindow,globalShortcut,screen}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),evidence=path.join(root,'evidence');
const before=process.argv.includes('--before-fix');
process.env.INKVOICE_DATA_DIR=path.join(evidence,before?'window-before-profile':'window-test-profile');
globalShortcut.register=()=>true;globalShortcut.unregisterAll=()=>{};
require('../src/main.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await sleep(100);}throw Error('Window test timed out');}
function info(win){const bounds=win.getBounds();return {visible:win.isVisible(),minimized:win.isMinimized(),focused:win.isFocused(),bounds,onScreen:screen.getAllDisplays().some(({workArea:a})=>bounds.x>=a.x&&bounds.y>=a.y&&bounds.x+bounds.width<=a.x+a.width&&bounds.y+bounds.height<=a.y+a.height)};}
app.whenReady().then(async()=>{
  const checks=[];let win;
  try{
    await until(()=>{win=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='墨声 · InkVoice');return win&&!win.webContents.isLoading();});
    await sleep(300);checks.push({name:'Cold launch',...info(win)});
    win.minimize();await until(()=>win.isMinimized());app.emit('second-instance',{},[],root,{});await sleep(400);checks.push({name:'Minimized second-instance event',...info(win)});
    if(!before){
      win.hide();app.emit('second-instance',{},[],root,{});await sleep(400);checks.push({name:'Hidden second-instance event',...info(win)});
      win.setBounds({x:-30000,y:-30000,width:1060,height:760});app.emit('second-instance',{},[],root,{});await sleep(400);checks.push({name:'Offscreen recovery',...info(win)});
      win.minimize();await until(()=>win.isMinimized());
      const second=spawn(process.execPath,[path.join(root,'src','main.cjs')],{env:process.env,stdio:'ignore',windowsHide:false});
      await new Promise((resolve,reject)=>{second.once('error',reject);second.once('exit',resolve);});await sleep(500);checks.push({name:'Actual repeated CLI launch',...info(win)});
    }
    const passed=checks.every(x=>x.visible&&!x.minimized&&x.onScreen&&x.focused);
    fs.writeFileSync(path.join(evidence,before?'window-startup-before.json':'window-startup-desktop.json'),JSON.stringify({at:new Date().toISOString(),passed,checks,scope:'Actual Electron own-window lifecycle, plus real repeated executable launch in isolated profile. No microphone/input/cloud.'},null,2));
    console.log(JSON.stringify({passed,checks},null,2));app.exit(before||passed?0:1);
  }catch(error){console.error(error.stack);app.exit(1);}
});
