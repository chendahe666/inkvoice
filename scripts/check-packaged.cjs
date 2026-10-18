'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),appRoot=path.join(root,'release','InkVoice','resources','app');
const service=require(path.join(appRoot,'src','services.cjs'));
(async()=>{
  const result=await service.transcribeWave(fs.readFileSync(path.join(root,'fixtures','dictation-zh.wav')),{root:appRoot,settings:{...service.DEFAULT_SETTINGS,language:'zh'}});
  assert.ok(result.text.includes('项目计划'),'Packaged ASR lost the expected Mandarin phrase');
  const record={passed:true,at:new Date().toISOString(),appRoot,result,scope:'Actual packaged whisper executable, bundled model and runtime DLL subset with synthetic Mandarin speech; no microphone or insertion'};
  fs.writeFileSync(path.join(root,'evidence','packaged-asr.json'),JSON.stringify(record,null,2));
  console.log(JSON.stringify(record,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
