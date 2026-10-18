'use strict';
// Actual Linux inference against the public WAV shipped in pinned upstream source.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const service=require('../src/services.cjs'),root=path.resolve(__dirname,'..');
(async()=>{
  if(process.platform!=='linux')throw Error('This optional integration check runs on Linux');
  const audio=path.join(root,'tools','linux-engine','whisper.cpp-d1be6fde11ac6e0407606b4e42fe72d34add8037','samples','jfk.wav');
  const engine=service.engineStatus(root);assert.ok(engine.ready,engine.reason);
  const result=await service.transcribeWave(fs.readFileSync(audio),{root,settings:{...service.DEFAULT_SETTINGS,language:'en'}});
  assert.ok(/fellow americans/i.test(result.text),'Published JFK fixture did not yield its expected phrase');
  const record={kind:'actual-linux-cpu-asr',passed:true,node:process.version,platform:process.platform,arch:process.arch,result,scope:'Actual pinned Linux Whisper executable and multilingual Q5_1 model transcribing the public JFK sample shipped in the verified source archive; no microphone or cloud.',limitations:['One public fixture verifies inference wiring; not an accuracy benchmark or physical microphone trial.']};
  fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(path.join(root,'evidence','linux-runtime.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record,null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
