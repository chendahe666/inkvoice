const fs=require('node:fs'),path=require('node:path');
const {refineText,DEFAULT_SETTINGS}=require('../src/services.cjs');
const root=path.resolve(__dirname,'..');
(async()=>{
  const record={kind:'optional-live-gemini-synthetic-text-check',at:new Date().toISOString(),input:'um tomorrow at nine we will discuss the project plan please bring your notes',status:'unavailable',credentialValueRecorded:false};
  try{
    const key=process.env.GEMINI_API_KEY;if(!key)throw Error('No existing GEMINI_API_KEY');
    const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':key},signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('Model list HTTP '+response.status);
    const payload=await response.json();const models=(payload.models||[]).filter(x=>x.supportedGenerationMethods?.includes('generateContent')).map(x=>x.name.replace(/^models\//,''));
    const selected=['gemini-3.5-flash-lite','gemini-3.8-flash','gemini-2.5-flash'].find(x=>models.includes(x));if(!selected)throw Error('No supported preferred text model');record.model=selected;
    record.polished=await refineText(record.input,{settings:{...DEFAULT_SETTINGS,geminiModel:selected,polishMode:'polish'},key});
    record.translated=await refineText('Tomorrow at nine we will discuss the project plan. Please bring your notes.',{settings:{...DEFAULT_SETTINGS,geminiModel:selected,polishMode:'translate',outputLanguage:'简体中文'},key});
    if(!record.polished.text||!/[\u4e00-\u9fff]/.test(record.translated.text))throw Error('Output contract not met');record.status='passed';
  }catch(e){record.error=e.message;}
  fs.mkdirSync(path.join(root,'evidence'),{recursive:true});fs.writeFileSync(path.join(root,'evidence','cloud-check.json'),JSON.stringify(record,null,2));console.log(JSON.stringify(record,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
