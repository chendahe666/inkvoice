'use strict';
const {app,BrowserWindow,ipcMain,globalShortcut,clipboard,dialog,Tray,Menu,nativeImage,screen,safeStorage,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const service=require('./services.cjs');
const root=path.resolve(__dirname,'..');
const smoke=process.argv.includes('--smoke-test'),captureSmoke=process.argv.includes('--capture-smoke'),testMode=smoke||captureSmoke;
const evidenceDir=process.env.INKVOICE_EVIDENCE_DIR||path.join(root,'evidence');
app.setName('InkVoice');
const dataDir=testMode?path.join(evidenceDir,'smoke-profile'):(process.env.INKVOICE_DATA_DIR||(process.platform==='linux'?app.getPath('userData'):path.join(app.isPackaged?path.dirname(process.execPath):root,'data')));
service.ensureDir(dataDir);app.setPath('userData',dataDir);
if(process.platform==='linux'){app.setDesktopName('org.inkvoice.InkVoice.desktop');app.commandLine.appendSwitch('enable-features','GlobalShortcutsPortal');}
if(captureSmoke){app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');app.commandLine.appendSwitch('use-file-for-fake-audio-capture',path.join(root,'fixtures','dictation-en.wav'));}
const configFile=path.join(dataDir,'settings.json'),historyFile=path.join(dataDir,'history.json');
let stored=service.readJson(configFile,{}),settings=service.sanitizeSettings(stored.settings);
if(testMode)settings={...settings,autoInsert:false,keepHistory:false};
let history=settings.keepHistory?service.readJson(historyFile,[]).filter(x=>x&&typeof x.text==='string').slice(0,30):[];
let state={phase:'idle',result:null,error:null,warning:null};
let mainWindow,overlayWindow,tray,quitting=false,activeSession=null,abortController=null,overlayTimer,recordingTimer;
let startingRecording=false,startGeneration=0,importDialogOpen=false;
let hotkeys={recordingRegistered:false,pasteRegistered:false};
const helper=process.platform==='linux'?path.join(root,'native','linux-input.py'):path.join(root,'native','bin','InkVoice.Input.exe');
function secureKeyStorage(){return safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||!['basic_text','unknown'].includes(safeStorage.getSelectedStorageBackend?.()||'unknown'));}
function apiKey(){if(stored.encryptedKey){try{if(secureKeyStorage())return safeStorage.decryptString(Buffer.from(stored.encryptedKey,'base64'));}catch{}}return process.env.GEMINI_API_KEY||'';}
function snapshot(){const e=service.engineStatus(root,settings);return {...state,settings:{...settings},engine:{ready:e.ready,modelName:e.modelName,modelBytes:e.modelBytes,reason:e.reason},history,providers:{geminiKeyAvailable:!!apiKey(),keySource:stored.encryptedKey?'saved':process.env.GEMINI_API_KEY?'environment':'none'},hotkeys:{...hotkeys}};}
function send(channel,payload){for(const win of [mainWindow,overlayWindow])if(win&&!win.isDestroyed())win.webContents.send(channel,payload);}
function publish(patch={}){Object.assign(state,patch);send('inkvoice:state',snapshot());updateOverlay();}
function updateOverlay(){if(testMode||!overlayWindow||overlayWindow.isDestroyed())return;if(['recording','transcribing','polishing'].includes(state.phase)){clearTimeout(overlayTimer);const area=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;overlayWindow.setPosition(Math.round(area.x+(area.width-360)/2),Math.round(area.y+area.height-110));overlayWindow.showInactive();}else if(state.phase==='ready'||state.phase==='error'){clearTimeout(overlayTimer);overlayTimer=setTimeout(()=>overlayWindow?.hide(),2400);}else overlayWindow.hide();}
function showWindow(reason='manual'){
  if(!app.isReady()||testMode)return;
  if(!mainWindow||mainWindow.isDestroyed())createWindows();
  const win=mainWindow;
  if(win.isMinimized())win.restore();
  const bounds=win.getBounds(),displays=screen.getAllDisplays();
  if(displays.length){
    const area=screen.getDisplayMatching(bounds).workArea;
    const minWidth=Math.min(900,area.width),minHeight=Math.min(650,area.height);
    win.setMinimumSize(minWidth,minHeight);
    const width=Math.max(minWidth,Math.min(bounds.width,area.width)),height=Math.max(minHeight,Math.min(bounds.height,area.height));
    const visibleBounds={x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds.y,area.y+area.height-height)),width,height};
    if(Object.keys(visibleBounds).some(key=>visibleBounds[key]!==bounds[key]))win.setBounds(visibleBounds);
  }
  win.show();win.moveTop();win.focus();app.focus();
}
function persist(){service.writeJson(configFile,{settings,encryptedKey:stored.encryptedKey||null});}
function saveHistory(result){if(!settings.keepHistory)return;history=[result,...history.filter(x=>x.id!==result.id)].slice(0,30);service.writeJson(historyFile,history);}
async function native(args,input,signal){if(!fs.existsSync(helper))throw Error('文字输入助手缺失，请重新构建应用。');const r=await service.runProcess(process.platform==='linux'?'python3':helper,process.platform==='linux'?[helper,...args]:args,{input,signal,timeoutMs:6000});try{return JSON.parse(r.stdout.trim().replace(/^\uFEFF/,''));}catch{throw Error('输入助手没有返回有效结果。');}}
async function foreground(){try{const target=await native(['--foreground']);return target.pid===process.pid?null:target;}catch{return null;}}
async function insertText(text,target,signal){if(!target?.handle)return {status:'held',message:process.platform==='linux'?'未定位到可自动写入的 X11 窗口，请复制结果后粘贴。Wayland 使用手动复制。':'回到目标窗口后，按 Ctrl+Alt+V 写入最近结果。'};try{const r=await native(['--insert','--target',String(target.handle)],text,signal);if(r.ok)return {status:'inserted',message:'已写入目标窗口。'};if(r.count>0||r.partial)return {status:'partial',message:'已写入部分文字，随后被中断。请检查目标窗口，避免重复写入。',insertedUnits:r.count,reason:r.reason};return {status:'held',message:r.reason==='focus-changed'?'目标窗口已切换；回到需要的位置，按 Ctrl+Alt+V。':process.platform==='linux'?'自动写入不可用，请复制结果后粘贴。':'自动写入未完成，可以复制结果或按 Ctrl+Alt+V 重试。',reason:r.reason};}catch{return {status:'held',message:'自动写入未完成，可以复制结果。'};}}
async function beginRecording(){
  if(startingRecording||importDialogOpen||['recording','transcribing','polishing'].includes(state.phase))return;
  const engine=service.engineStatus(root,settings);if(!engine.ready){publish({phase:'error',error:engine.reason});return;}
  startingRecording=true;const generation=++startGeneration;
  try{const target=testMode?null:await foreground();if(generation!==startGeneration||importDialogOpen)return;const id=crypto.randomUUID();activeSession={id,target,startedAt:Date.now()};publish({phase:'recording',error:null,warning:null});mainWindow.webContents.send('inkvoice:recorder',{type:'start',sessionId:id});clearTimeout(recordingTimer);recordingTimer=setTimeout(stopRecording,300000);}
  finally{startingRecording=false;}
}
function stopRecording(){if(state.phase!=='recording'||!activeSession)return;clearTimeout(recordingTimer);publish({phase:'transcribing'});mainWindow.webContents.send('inkvoice:recorder',{type:'stop',sessionId:activeSession.id});}
async function toggleRecording(){if(startingRecording||importDialogOpen)return;if(state.phase==='recording')stopRecording();else if(!['transcribing','polishing'].includes(state.phase))await beginRecording();}
function cancel(){startGeneration++;const id=activeSession?.id;activeSession=null;clearTimeout(recordingTimer);abortController?.abort();abortController=null;if(id)mainWindow?.webContents.send('inkvoice:recorder',{type:'cancel',sessionId:id});publish({phase:'idle',error:null,warning:null});}
async function processAudio(buffer,{sessionId,target=null,fromImport=false}={}){
  if(!activeSession||activeSession.id!==sessionId)return;abortController=new AbortController();const signal=abortController.signal;publish({phase:'transcribing',error:null,warning:null});
  try{const transcription=await service.transcribeWave(buffer,{root,dataDir,settings,signal});if(signal.aborted||activeSession?.id!==sessionId)return;let final={text:transcription.text,polishMs:0,mode:'basic'},warning=null;
    if(settings.polishMode!=='basic'){publish({phase:'polishing'});try{final=await service.refineText(transcription.text,{settings,key:apiKey(),signal});}catch(e){if(signal.aborted)return;warning=e.message;}}
    if(signal.aborted||activeSession?.id!==sessionId)return;let insertion={status:'held',message:fromImport?'已完成音频转写。可以复制结果。':'回到目标窗口后，按 Ctrl+Alt+V 写入。'};
    if(settings.autoInsert&&!testMode&&!fromImport&&!warning)insertion=await insertText(final.text,target,signal);if(signal.aborted||activeSession?.id!==sessionId)return;if(warning)insertion={status:'held',message:'AI 处理未完成，已保留原转写，请检查后使用。'};
    const result=service.newResult({...transcription,...final,insertion,warning});saveHistory(result);activeSession=null;abortController=null;publish({phase:'ready',result,error:null,warning});
  }catch(e){if(signal.aborted||activeSession?.id!==sessionId)return;activeSession=null;abortController=null;publish({phase:'error',error:e.message});}
}
async function pasteLast(){if(testMode||!state.result?.text)return;const prior=state.result;const insertion=await insertText(prior.text,await foreground());if(state.result?.id!==prior.id)return;state.result={...state.result,insertion};if(history.some(x=>x.id===prior.id))saveHistory(state.result);publish();}
function registerHotkeys(next=settings.hotkey){globalShortcut.unregisterAll();hotkeys={recordingRegistered:false,pasteRegistered:false};try{hotkeys.recordingRegistered=globalShortcut.register(next,()=>{void toggleRecording();});}catch{}try{hotkeys.pasteRegistered=globalShortcut.register('Ctrl+Alt+V',()=>{void pasteLast();});}catch{}}
function checkSender(event){if(!mainWindow||event.sender!==mainWindow.webContents)throw Error('不支持的请求来源。');}
function handle(name,fn){ipcMain.handle(name,async(event,...args)=>{checkSender(event);return fn(...args);});}
function configureIPC(){
  handle('inkvoice:get-state',()=>snapshot());handle('inkvoice:toggle',()=>toggleRecording());handle('inkvoice:cancel',()=>cancel());
  handle('inkvoice:audio',payload=>{if(!payload||payload.sessionId!==activeSession?.id||state.phase!=='transcribing')return {ok:false};const buffer=Buffer.from(payload.wav);if(buffer.length>20000000)throw Error('录音文件过大。');void processAudio(buffer,{sessionId:payload.sessionId,target:activeSession.target});return {ok:true};});
  handle('inkvoice:recording-error',payload=>{if(payload?.sessionId===activeSession?.id){clearTimeout(recordingTimer);activeSession=null;publish({phase:'error',error:String(payload.message||'无法使用麦克风。').slice(0,500)});}});
  handle('inkvoice:settings',patch=>{if(['recording','transcribing','polishing'].includes(state.phase))return {ok:false,message:'请在当前录音处理结束后修改设置。'};const next=service.sanitizeSettings({...settings,...patch}),previous=settings;if(next.hotkey==='Ctrl+Alt+V')return {ok:false,message:'此快捷键用于写入最近结果，请选另一个。'};if(next.hotkey!==settings.hotkey){registerHotkeys(next.hotkey);if(!hotkeys.recordingRegistered){registerHotkeys(previous.hotkey);return {ok:false,message:'快捷键已被占用或格式无效。'};}}settings=next;if(!settings.keepHistory){history=[];service.writeJson(historyFile,[]);}persist();publish();return {ok:true};});
  handle('inkvoice:key',key=>{if(typeof key!=='string'||key.length>1000)return {ok:false,message:'密钥格式无效。'};if(key.trim()){if(!secureKeyStorage())return {ok:false,message:'系统密钥环不可用，密钥未保存。请启动 Secret Service/KWallet 后重试，或使用临时环境变量。'};stored.encryptedKey=safeStorage.encryptString(key.trim()).toString('base64');}else stored.encryptedKey=null;persist();publish();return {ok:true};});
  handle('inkvoice:copy',text=>{if(typeof text==='string'&&text.length<=200000)clipboard.writeText(text);return {ok:true};});
  handle('inkvoice:update-draft',payload=>{if(['recording','transcribing','polishing'].includes(state.phase))return {ok:false,message:'正在处理，请完成后再修改文字。'};if(!state.result||payload?.id!==state.result.id||typeof payload.text!=='string'||payload.text.length>200000)return {ok:false,message:'结果已更新，请重新选择要修改的文字。'};state.result={...state.result,text:payload.text};saveHistory(state.result);return {ok:true};});
  handle('inkvoice:select-result',id=>{if(['recording','transcribing','polishing'].includes(state.phase))return {ok:false,message:'请先完成当前录音。'};const item=history.find(x=>x.id===id);if(!item)return {ok:false,message:'找不到这条记录。'};publish({phase:'ready',result:item,error:null,warning:item.warning||null});return {ok:true};});
  handle('inkvoice:clear-history',()=>{history=[];service.writeJson(historyFile,[]);publish();return {ok:true};});
  handle('inkvoice:delete-history',id=>{history=history.filter(x=>x.id!==id);service.writeJson(historyFile,history);publish();return {ok:true};});
  handle('inkvoice:hide',()=>mainWindow.hide());handle('inkvoice:open-data',()=>shell.openPath(dataDir));
  handle('inkvoice:import',async()=>{if(importDialogOpen||startingRecording||['recording','transcribing','polishing'].includes(state.phase))return {ok:false,message:'请先完成当前录音。'};importDialogOpen=true;let files;try{files=await dialog.showOpenDialog(mainWindow,{properties:['openFile'],filters:[{name:'16 kHz 单声道 WAV 音频',extensions:['wav']}]});}finally{importDialogOpen=false;}if(files.canceled)return {ok:false,canceled:true};const filename=files.filePaths[0];if(fs.statSync(filename).size>20000000){publish({phase:'error',error:'音频文件过大。'});return {ok:false};}const id=crypto.randomUUID();activeSession={id,target:null};void processAudio(fs.readFileSync(filename),{sessionId:id,fromImport:true});return {ok:true};});
  handle('inkvoice:retry-polish',async()=>{if(importDialogOpen||startingRecording||!state.result||['recording','transcribing','polishing'].includes(state.phase))return {ok:false,message:'请先完成当前录音或文件选择。'};const prior=state.result;if(!prior.text.trim())return {ok:false,message:'请先输入需要整理的文字。'};abortController=new AbortController();const controller=abortController;publish({phase:'polishing',error:null,warning:null});try{const refined=await service.refineText(service.cleanText(prior.text,settings.dictionary),{settings,key:apiKey(),signal:controller.signal});if(controller.signal.aborted)return {ok:false};state.result={...prior,...refined,warning:null,insertion:{status:'held',message:'已更新结果，可以复制或按 Ctrl+Alt+V 写入。'}};saveHistory(state.result);publish({phase:'ready'});return {ok:true};}catch(e){if(!controller.signal.aborted)publish({phase:'ready',warning:e.message});return {ok:false};}finally{if(abortController===controller)abortController=null;}});
}
function createWindows(){
  if(mainWindow&&!mainWindow.isDestroyed())return;
  const win=mainWindow=new BrowserWindow({width:1060,height:760,minWidth:900,minHeight:650,show:false,backgroundColor:'#f6f7f9',title:'墨声 · InkVoice',autoHideMenuBar:true,icon:path.join(__dirname,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((webContents,permission,callback,details)=>callback(webContents===win.webContents&&permission==='media'&&(details.mediaTypes||[]).every(t=>t==='audio')));
  win.webContents.session.setPermissionCheckHandler((webContents,permission)=>webContents===win.webContents&&permission==='media');
  win.once('ready-to-show',()=>{if(!testMode&&!win.isDestroyed()&&mainWindow===win)showWindow('ready-to-show');});
  win.on('close',event=>{if(!quitting&&!testMode){event.preventDefault();win.hide();}});
  win.on('closed',()=>{if(mainWindow===win)mainWindow=null;});
  win.loadFile(path.join(__dirname,'ui.html'));
  if(!testMode&&(!overlayWindow||overlayWindow.isDestroyed())){overlayWindow=new BrowserWindow({width:360,height:64,show:false,frame:false,transparent:true,resizable:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,webPreferences:{preload:path.join(__dirname,'overlay-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});overlayWindow.loadFile(path.join(__dirname,'overlay.html'));}
}
function createTray(){let icon=nativeImage.createFromPath(path.join(__dirname,'icon.png'));if(icon.isEmpty())icon=nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');tray=new Tray(icon.resize({width:20,height:20}));tray.setToolTip('墨声 InkVoice · '+settings.hotkey);tray.setContextMenu(Menu.buildFromTemplate([{label:'打开墨声',click:showWindow},{label:'开始 / 结束录音',click:()=>void toggleRecording()},{label:'写入最近结果  Ctrl+Alt+V',click:()=>void pasteLast()},{type:'separator'},{label:'退出墨声',click:()=>{quitting=true;app.quit();}}]));tray.on('double-click',showWindow);}
async function waitFor(predicate,timeoutMs=20000){const start=Date.now();while(Date.now()-start<timeoutMs){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('等待应用状态超时。');}
async function runSmoke(){
  await waitFor(()=>mainWindow.webContents.executeJavaScript('Boolean(window.inkvoiceTest && document.readyState === "complete")'));
  const ui=await mainWindow.webContents.executeJavaScript('window.inkvoiceTest.runSelfTest()');if(!ui?.passed)throw Error('界面音频转换自检失败。');service.ensureDir(evidenceDir);
  await mainWindow.webContents.executeJavaScript('document.fonts.ready.then(()=>{document.getAnimations().forEach(a=>a.finish());return true;})');
  async function captureUI(name){await mainWindow.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');fs.writeFileSync(path.join(evidenceDir,name+'.png'),(await mainWindow.webContents.capturePage()).toPNG());}
  const views=[];
  async function inspectView(view,name){await mainWindow.webContents.executeJavaScript(`document.querySelector('[data-view="${view}"]').click()`);const layout=await mainWindow.webContents.executeJavaScript(`({view:${JSON.stringify(view)},width:innerWidth,height:innerHeight,visible:!document.getElementById('view-${view}').hidden,horizontalOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth||document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth})`);if(!layout.visible||layout.horizontalOverflow)throw Error('界面布局检查失败：'+JSON.stringify(layout));views.push(layout);await captureUI(name);}
  await captureUI('ui-preview');let capture=null;
  if(captureSmoke){
    await beginRecording();await new Promise(r=>setTimeout(r,1000));await captureUI('ui-recording-preview');await new Promise(r=>setTimeout(r,9800));stopRecording();
    await waitFor(()=>state.phase==='ready'||state.phase==='error',120000);capture={phase:state.phase,error:state.error,result:state.result};if(state.phase!=='ready')throw Error('合成音频录音流程失败：'+state.error);if(state.result.insertion.status!=='held')throw Error('测试模式意外触发写入。');
    const expected=state.result.text;await waitFor(()=>mainWindow.webContents.executeJavaScript('document.getElementById("result-text").value').then(value=>value===expected));capture.renderer=await mainWindow.webContents.executeJavaScript('({text:document.getElementById("result-text").value,readOnly:document.getElementById("result-text").readOnly,title:document.getElementById("record-title").textContent,notice:document.getElementById("notice").hidden?null:document.getElementById("notice").textContent})');if(capture.renderer.readOnly)throw Error('完成后的成文仍不可编辑。');await captureUI('ui-result-preview');
  }
  await inspectView('history','ui-history-preview');await inspectView('settings','ui-settings-preview');
  await mainWindow.webContents.executeJavaScript('window.scrollTo(0,document.documentElement.scrollHeight)');
  await captureUI('ui-settings-bottom-preview');
  const settingsFooter=await mainWindow.webContents.executeJavaScript('({openDataBottom:document.getElementById("open-data-folder").getBoundingClientRect().bottom,saveTop:document.querySelector(".settings-actions").getBoundingClientRect().top})');
  if(settingsFooter.openDataBottom>settingsFooter.saveTop)throw Error('设置保存条遮住了最后一个控件。');
  mainWindow.setSize(900,650);await inspectView('home','ui-compact-preview');
  const hashes=Object.fromEntries(['ui.html','ui.css','renderer.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,file))).digest('hex')]));
  const report={kind:captureSmoke?'fake-device-real-capture-asr-smoke':'desktop-renderer-smoke',at:new Date().toISOString(),rendererReady:true,title:mainWindow.getTitle(),ui,interface:{views,hashes,settingsFooter},engine:snapshot().engine,hotkeys,effectiveHotkey:settings.hotkey,capture,limitations:['Synthetic source for capture smoke; does not prove physical microphone availability','Native insertion is separately tested against our own Windows control']};service.writeJson(path.join(evidenceDir,captureSmoke?'capture-smoke.json':'desktop-smoke.json'),report);quitting=true;app.exit(0);
}
const lock=testMode||app.requestSingleInstanceLock();if(!lock)app.quit();else{app.on('second-instance',()=>showWindow('second-instance'));app.whenReady().then(async()=>{configureIPC();createWindows();registerHotkeys();if(!hotkeys.recordingRegistered){for(const candidate of ['Ctrl+Shift+Space','Ctrl+Alt+F9','Ctrl+Shift+F9']){registerHotkeys(candidate);if(hotkeys.recordingRegistered){settings.hotkey=candidate;persist();break;}}}if(!testMode)createTray();if(testMode)try{await runSmoke();}catch(e){service.ensureDir(evidenceDir);service.writeJson(path.join(evidenceDir,'smoke-error.json'),{error:e.stack});quitting=true;app.exit(1);}}).catch(e=>{console.error(e);app.exit(1);});}
app.on('before-quit',()=>{quitting=true;clearTimeout(recordingTimer);abortController?.abort();globalShortcut.unregisterAll();});app.on('window-all-closed',()=>{if(testMode||quitting)app.quit();});
