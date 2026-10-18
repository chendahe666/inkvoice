const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {DEFAULT_SETTINGS,transcribeWave,cleanText,inspectWave}=require('../src/services.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const wav=fs.readFileSync(path.join(root,'fixtures/dictation-en.wav'));
  const result=await transcribeWave(wav,{root,dataDir:path.join(root,'evidence','test-data'),settings:{...DEFAULT_SETTINGS,language:'en'}});
  fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(path.join(root,'evidence','f1-asr-observation.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({observedText:result.text},null,2));
  const lower=result.text.toLowerCase();const required=['tomorrow','project','plan','notes'];for(const term of required)assert.ok(lower.includes(term),`Real ASR missing expected word: ${term}`);assert.ok(/\b(?:nine|9)\b/.test(lower),'Real ASR missing spoken number nine/9');
  assert.equal(cleanText('  扣得克斯   API  ','扣得克斯 => Codex'),'Codex API');
  assert.equal(cleanText('I really really need this.\n第二行。'),'I really really need this.\n第二行。');
  assert.throws(()=>inspectWave(Buffer.from('not audio')));
  const record={kind:'real-synthetic-speech-local-asr',status:'passed',requiredWords:[...required,'nine OR 9'],result,wave:inspectWave(wav),limitations:['Synthetic English voice only, not human speech or Mandarin accuracy evaluation','Observed brand name Ink Voice was transcribed as Inc. Voice; this is retained, not scored away','Does not test microphone capture or actual text insertion']};
  fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(path.join(root,'evidence','f1-transcription.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({status:'passed',text:result.text,asrMs:result.asrMs,durationSeconds:result.durationSeconds},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
