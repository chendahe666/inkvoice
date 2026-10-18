'use strict';
// Synthetic Linux integration checks. No keyring, input, audio, network or real user data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/main.cjs'),'utf8');
const handlers=new Map(),writes=[],calls=[],switches=[];
let backend='basic_text',dataPath,desktopName;
const webContents={send(){}};
const app={isPackaged:true,setName(){},getPath(){return '/synthetic/config/InkVoice';},setPath(name,value){dataPath=value;},setDesktopName(value){desktopName=value;},commandLine:{appendSwitch(...args){switches.push(args);}},requestSingleInstanceLock(){return false;},quit(){},on(){}};
const service={...require('../src/services.cjs'),ensureDir(){},readJson(file,fallback){return fallback;},writeJson(file,value){writes.push({file,value});},async runProcess(exe,args){calls.push({exe,args});return {stdout:JSON.stringify({handle:'123',pid:42}),code:0};}};
const electron={app,ipcMain:{handle(name,fn){handlers.set(name,fn);}},safeStorage:{isEncryptionAvailable(){return true;},getSelectedStorageBackend(){return backend;},encryptString(value){return Buffer.from('SYNTHETIC-ENCRYPTED-'+value);}},globalShortcut:{unregisterAll(){},register(){return true;}}};
const context=vm.createContext({__dirname:path.join(root,'src'),require(id){if(id==='electron')return electron;if(id==='./services.cjs')return service;if(id==='node:fs')return {...fs,existsSync(){return true;}};return require(id);},process:{platform:'linux',argv:[],env:{},pid:999,execPath:'/synthetic/InkVoice'},Buffer,console,setTimeout,clearTimeout,AbortController,AbortSignal});
vm.runInContext(source+'\nmainWindow={webContents:globalThis.syntheticWebContents,isDestroyed:()=>false};configureIPC();globalThis.integration={foreground,secureKeyStorage};',Object.assign(context,{syntheticWebContents:webContents}));
(async()=>{
 assert.equal(dataPath,'/synthetic/config/InkVoice');
 assert.equal(desktopName,'org.inkvoice.InkVoice.desktop');
 assert.ok(switches.some(args=>args[0]==='enable-features'&&args[1]==='GlobalShortcutsPortal'));
 assert.equal(context.integration.secureKeyStorage(),false);
 let result=await handlers.get('inkvoice:key')({sender:webContents},'SYNTHETIC-KEY');
 assert.equal(result.ok,false);assert.equal(writes.length,0,'basic_text must never persist credentials');
 backend='unknown';assert.equal(context.integration.secureKeyStorage(),false);
 backend='gnome_libsecret';assert.equal(context.integration.secureKeyStorage(),true);
 result=await handlers.get('inkvoice:key')({sender:webContents},'SYNTHETIC-KEY');
 assert.equal(result.ok,true);assert.equal(writes.length,1);
 const target=await context.integration.foreground();assert.equal(target.handle,'123');
 assert.equal(calls.length,1);assert.equal(calls[0].exe,'python3');
 assert.equal(calls[0].args[0],path.join(root,'native','linux-input.py'));
 assert.equal(calls[0].args[1],'--foreground');
 console.log(JSON.stringify({passed:true,kind:'synthetic-linux-main-integration',checks:['standard-user-data-path','portal-desktop-identity','reject-basic-text-and-unknown-keyrings','encrypted-keyring-path','python-helper-dispatch'],limitations:'Mocks only; no actual keyring, compositor or desktop input'},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
