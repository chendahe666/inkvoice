'use strict';
// Audit exact staged Git blobs without printing credential values or user content.
const {spawnSync}=require('node:child_process');
const root=require('node:path').resolve(__dirname,'..');
function git(args){const r=spawnSync('git',args,{cwd:root,windowsHide:true,maxBuffer:32*1024*1024});if(r.status!==0)throw Error('Git audit failed; run from an initialized repository with staged files.');return r.stdout;}
const entries=git(['ls-files','--stage','-z']).toString('utf8').split('\0').filter(Boolean);
if(!entries.length)throw Error('No staged files to audit. Stage the intended public files first.');
const findings=[];let checked=0;
const forbidden=/^(?:data|evidence|fixtures|runtime|models|tools|node_modules|release|release-backups|implement-stage|design|design-system|publication|\.agents|\.codex|\.claude)(?:\/|$)|(?:^|\/)data\/|^native\/bin\//i;
const privateFiles=/(?:^|\/)(?:\.env(?:\..*)?|settings\.json|history\.json|local\.properties)$|\.(?:wav|mp3|m4a|flac|ogg|opus|log|pem|key|p12|pfx|jks|keystore|mobileprovision|ipa|apk|aab|exe|dll|bin|pdb|zip|7z)$/i;
for(const entry of entries){
  const match=/^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/.exec(entry);if(!match)throw Error('Unexpected Git index entry');
  const [,mode,sha,stage,file]=match;checked++;
  if(stage!=='0'||!['100644','100755'].includes(mode))findings.push({file,kind:'non-regular-or-unmerged-file'});
  if(forbidden.test(file)||privateFiles.test(file)||file==='DESIGN.md')findings.push({file,kind:'private-or-generated-path'});
  const bytes=git(['cat-file','blob',sha]);if(bytes.length>1024*1024)findings.push({file,kind:'unexpected-large-source-file'});
  if(/(?:^|\/)(?:build|\.gradle|\.cxx|DerivedData|xcuserdata)\//.test(file))findings.push({file,kind:'mobile-generated-path'});
  if(file.endsWith('.jar')){
    const hash=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
    // Official Gradle 8.11.1 wrapper checksum, independently checked against services.gradle.org.
    if(file!=='mobile/android/gradle/wrapper/gradle-wrapper.jar'||hash!=='2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046')findings.push({file,kind:'unverified-binary'});
    continue;
  }
  if(file.endsWith('.png'))continue;
  const text=bytes.toString('utf8');
  const patterns=[
    ['credential-token',/\b(?:AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/],
    ['private-key',/-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['personal-windows-path',/[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/"'\s]+/],
    ['credential-literal',/(?:encryptedKey|apiKey|api_key|secret|token)\s*[:=]\s*["'][A-Za-z0-9_+/=.-]{24,}["']/i]
  ];
  for(const [kind,pattern]of patterns)if(pattern.test(text))findings.push({file,kind});
}
console.log(JSON.stringify({passed:findings.length===0,checkedFiles:checked,scope:'Exact staged Git blobs: prohibited data paths, credential patterns, private paths and generated binaries',findings},null,2));
if(findings.length)process.exitCode=1;
