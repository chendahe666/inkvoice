'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const api = window.inkvoice;
  let state = null;
  let activeTab = 'text';
  let shownResultId = null;
  let edits = {text: '', raw: ''};
  let capture = null;
  let toastTimer;
  let settingsDirty = false;
  let micOptions = [];
  const bars = Array.from({length:35}, () => {const bar = document.createElement('i');$('waveform').appendChild(bar);return bar;});
  const busyPhases = new Set(['recording','transcribing','polishing']);
  const phaseCopy = {
    idle:['准备录音','使用快捷键开始，结束后自动转为文字。'],
    recording:['正在录音','再次点击或按快捷键结束，最长 5 分钟。'],
    transcribing:['正在识别','正在本机处理音频，请稍候。'],
    polishing:['正在整理','正在通过 Gemini 处理转写文字。'],
    ready:['转写完成','可修改成文、复制，或继续下一段录音。'],
    error:['暂时无法继续','检查下方提示后重试。']
  };
  function toast(message) {
    $('toast').textContent = message;$('toast').hidden = false;clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {$('toast').hidden = true;},3600);
  }
  function showError(error) {$('notice').textContent = error?.message || String(error);$('notice').classList.add('error');$('notice').hidden = false;}
  async function call(method,...args) {
    if (!api || typeof api[method] !== 'function') throw new Error('应用连接尚未就绪，请重新启动墨声。');
    const result = await api[method](...args);
    if (result && result.ok === false && !result.canceled) throw new Error(result.error || result.message || '操作未能完成。');
    return result;
  }
  function invoke(method,...args) {return call(method,...args).catch(showError);}
  function setView(view) {
    document.querySelectorAll('.view').forEach(el => {el.hidden = el.id !== `view-${view}`;el.classList.toggle('active',!el.hidden);});
    document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active',el.dataset.view === view));
    window.scrollTo(0,0);if (view === 'settings') refreshMicrophones();
    if (view === 'history') {renderHistory();call('getState').then(render).catch(showError);}
  }
  function duration(seconds) {const value = Math.max(0,Math.floor(seconds || 0));return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`;}
  function dateLabel(value) {const date = new Date(value);return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});}
  function updateText() {
    $('result-text').value = edits[activeTab] || '';
    $('result-text').readOnly = activeTab === 'raw' || !shownResultId || state?.result?.id !== shownResultId || busyPhases.has(state?.phase);
    $('result-text').setAttribute('aria-label',activeTab === 'raw' ? '只读的原始转写' : '可编辑的成文');
    $('tab-final').classList.toggle('active',activeTab === 'text');$('tab-raw').classList.toggle('active',activeTab === 'raw');
    $('tab-final').setAttribute('aria-selected',String(activeTab === 'text'));$('tab-raw').setAttribute('aria-selected',String(activeTab === 'raw'));
    $('copy-result').disabled = !$('result-text').value.trim();
  }
  function render(snapshot) {
    state = snapshot;const phase = state.phase || 'idle';const busy = busyPhases.has(phase);const recording = phase === 'recording';
    const card = document.querySelector('.record-card');card.classList.toggle('recording',recording);card.classList.toggle('busy',busy && !recording);
    $('result-text').readOnly = activeTab === 'raw' || !shownResultId || state?.result?.id !== shownResultId || busy;
    const copy = phaseCopy[phase] || phaseCopy.idle;$('record-title').textContent = copy[0];$('record-description').textContent = copy[1];
    $('record-button').disabled = (busy && !recording) || (!state.engine?.ready && !recording);$('record-button').setAttribute('aria-label',recording ? '结束录音并识别' : '开始录音');
    $('record-label').textContent = recording ? '结束录音' : busy ? '处理中' : '开始录音';
    if (!recording) $('record-time').textContent = busy ? '处理中' : duration(state.result?.durationSeconds || 0);
    $('cancel-job').hidden = !busy;$('import-audio').disabled = busy || !state.engine?.ready;
    const engineReady = !!state.engine?.ready;$('engine-label').textContent = engineReady ? '本地识别已就绪' : '本地模型未就绪';$('engine-dot').className = `status-dot ${engineReady ? 'ready' : 'error'}`;
    $('notice').hidden = !state.error && !state.warning && (engineReady || busy);$('notice').classList.toggle('error',!!state.error);
    if (state.error) $('notice').textContent = state.error;else if (state.warning) $('notice').textContent = state.warning;else if (!engineReady) $('notice').textContent = state.engine?.reason || '本地模型正在准备。可在设置中检查模型路径。';
    const mode = state.settings?.polishMode || 'basic';document.querySelectorAll('[data-mode]').forEach(button => {button.classList.toggle('active',button.dataset.mode === mode);button.disabled = busy;});
    $('cloud-note').hidden = mode === 'basic';$('cloud-settings').hidden = !!state.providers?.geminiKeyAvailable;$('privacy-summary').textContent = mode === 'basic' ? '本机识别 · 仅保存文字' : '本机识别 · 文字传云端';
    if (state.result && (shownResultId !== state.result.id || state.result.text !== edits.sourceText)) {
      shownResultId = state.result.id;edits = {text:state.result.text || '',raw:state.result.raw || '',sourceText:state.result.text || ''};updateText();
    }
    if (!state.result) {shownResultId=null;edits={text:'',raw:'',sourceText:''};updateText();}
    const result = state.result;$('result-meta').textContent = result ? `${dateLabel(result.createdAt)} · ${duration(result.durationSeconds)}${result.asrMs ? ` · 识别 ${(result.asrMs/1000).toFixed(1)} 秒` : ''}` : '暂无结果';
    $('insertion-status').textContent = result?.insertion?.message || (state.settings?.autoInsert ? '录音结束后，可自动写入原应用' : '自动写入已关闭，可复制文字或使用写入快捷键');
    $('retry-polish').hidden = busy || mode === 'basic' || !result?.raw;$('key-status').textContent = state.providers?.geminiKeyAvailable ? '密钥已就绪；不会显示密钥内容。' : '尚未配置 API 密钥。';
    $('model-detail').textContent = engineReady ? `${state.engine.modelName || '多语言模型'}${state.engine.modelBytes ? ` · ${(state.engine.modelBytes/1048576).toFixed(0)} MB` : ''} · 在本机运行` : (state.engine?.reason || '模型未就绪');
    const shortcut=state.settings?.hotkey || 'Ctrl+Alt+Space';
    const shortcutParts = [`录音：${shortcut.split('+').join(' + ')}`,'写入：Ctrl + Alt + V'];if (state.hotkeys?.recordingRegistered === false) shortcutParts[0] += '（快捷键被占用）';if (state.hotkeys?.pasteRegistered === false) shortcutParts[1] += '（快捷键被占用）';$('shortcut-status').textContent = shortcutParts.join(' · ');
    const keyLine=document.querySelector('.hotkey-line');keyLine.replaceChildren();shortcut.split('+').forEach((key,index) => {if(index){const plus=document.createElement('span');plus.textContent='+';keyLine.appendChild(plus);}const cap=document.createElement('kbd');cap.textContent=key;keyLine.appendChild(cap);});const caption=document.createElement('span');caption.className='key-caption';caption.textContent=state.hotkeys?.recordingRegistered === false ? '被占用 · 请在设置中更换' : '开始 / 结束';keyLine.appendChild(caption);
    if (!settingsDirty) populateSettings(state.settings || {});renderHistory();
  }
  function populateSettings(settings) {
    $('setting-language').value = settings.language || 'auto';$('setting-output-language').value = settings.outputLanguage || 'zh-CN';$('setting-insert').checked = settings.autoInsert !== false;$('setting-history').checked = settings.keepHistory !== false;
    $('setting-model').value = settings.modelPath || '';$('setting-dictionary').value = settings.dictionary || '';$('setting-gemini-model').value = settings.geminiModel || 'gemini-3.5-flash-lite';
    const hotkey=settings.hotkey || 'Ctrl+Alt+Space';if(!Array.from($('setting-hotkey').options).some(option=>option.value===hotkey)){const option=document.createElement('option');option.value=hotkey;option.textContent=hotkey.split('+').join(' + ');$('setting-hotkey').appendChild(option);}$('setting-hotkey').value=hotkey;renderMicrophones(settings.microphoneId || 'default');
  }
  function renderMicrophones(selected) {
    const select = $('setting-microphone');select.replaceChildren();const add = (value,label) => {const option = document.createElement('option');option.value = value;option.textContent = label;select.appendChild(option);};
    add('default','系统默认麦克风');micOptions.filter(device => device.deviceId !== 'default').forEach((device,index) => add(device.deviceId,device.label || `麦克风 ${index+1}`));
    if (selected && selected !== 'default' && !micOptions.some(device => device.deviceId === selected)) add(selected,'之前选择的麦克风（当前未发现）');select.value = selected || 'default';
  }
  async function refreshMicrophones() {try {micOptions = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput');renderMicrophones($('setting-microphone').value || state?.settings?.microphoneId || 'default');} catch (_) { /* Actual capture reports access errors. */ }}
  function renderHistory() {
    const history = state?.history || [];$('history-count').textContent = `${history.length} 条记录`;$('history-empty').hidden = history.length > 0;$('clear-history').disabled = !history.length;$('history-list').replaceChildren();
    for (const item of history) {
      const finalText=item.text ?? item.raw ?? '';
      const article = document.createElement('article');article.className = 'history-item';const head = document.createElement('div');head.className = 'history-item-head';const stamp = document.createElement('span');stamp.textContent = dateLabel(item.createdAt);const length = document.createElement('span');length.textContent = `${duration(item.durationSeconds)} · ${finalText.length} 字`;head.append(stamp,length);
      const body = document.createElement('p');body.textContent = finalText || '（空白成文）';const actions = document.createElement('div');actions.className = 'history-item-actions';
      const button = (label,handler,style='') => {const el = document.createElement('button');el.type = 'button';el.className = `text-button ${style}`;el.textContent = label;el.addEventListener('click',handler);return el;};
      const copyHistory=button('复制文字',async () => {try {await call('copyText',finalText);toast('已复制到剪贴板');} catch(error) {showError(error);}});copyHistory.disabled=!finalText.trim();
      actions.append(button('在工作台查看',async () => {try {await call('selectResult',item.id);render(await call('getState'));activeTab='text';updateText();setView('home');} catch(error) {toast(error.message);}}),copyHistory,button('删除',() => invoke('deleteHistory',item.id),'danger'));
      article.append(head,body,actions);$('history-list').appendChild(article);
    }
  }
  function mergeChunks(chunks) {const all = new Float32Array(chunks.reduce((sum,chunk) => sum+chunk.length,0));let offset = 0;for (const chunk of chunks) {all.set(chunk,offset);offset += chunk.length;}return all;}
  function resample(samples,sourceRate,targetRate=16000) {
    if (!(samples instanceof Float32Array)) samples = new Float32Array(samples);
    if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) throw new Error('无效的音频采样率。');
    if (sourceRate === targetRate) return samples.slice();const ratio = sourceRate/targetRate;const output = new Float32Array(Math.floor(samples.length/ratio));
    if (ratio > 1) {
      for (let i=0;i<output.length;i++) {const left=i*ratio;const right=Math.min(samples.length,left+ratio);let sum=0;for(let j=Math.floor(left);j<Math.ceil(right);j++) sum += samples[j]*(Math.min(right,j+1)-Math.max(left,j));output[i]=sum/(right-left);}
    } else {
      for(let i=0;i<output.length;i++) {const position=i*ratio;const j=Math.floor(position);const fraction=position-j;output[i]=samples[j]*(1-fraction)+(samples[Math.min(j+1,samples.length-1)] || 0)*fraction;}
    }
    return output;
  }
  function encodeWav(samples,sampleRate=16000) {
    const buffer=new ArrayBuffer(44+samples.length*2);const view=new DataView(buffer);const ascii=(offset,value) => {for(let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i));};
    ascii(0,'RIFF');view.setUint32(4,36+samples.length*2,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,samples.length*2,true);
    for(let i=0;i<samples.length;i++) {const value=Math.max(-1,Math.min(1,Number.isFinite(samples[i]) ? samples[i] : 0));view.setInt16(44+i*2,Math.round(value*(value<0 ? 32768 : 32767)),true);}return buffer;
  }
  async function releaseCapture(session) {
    clearInterval(session.timer);if(session.stream) session.stream.getTracks().forEach(track => track.stop());try {session.source?.disconnect();session.node?.disconnect();session.gain?.disconnect();} catch(_) {}try {if(session.context && session.context.state !== 'closed') await session.context.close();} catch(_) {}
  }
  async function startCapture(sessionId) {
    if(capture) {capture.aborted=true;await releaseCapture(capture);}
    const session={id:sessionId,chunks:[],aborted:false,stopping:false,started:performance.now(),levels:[],maxNotified:false};capture=session;
    try {
      const selected=state?.settings?.microphoneId || 'default';session.stream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:selected === 'default' ? undefined : {exact:selected},channelCount:{ideal:1},sampleRate:{ideal:16000},echoCancellation:true,noiseSuppression:true},video:false});
      if(session.aborted || capture !== session) {await releaseCapture(session);return;}
      session.context=new AudioContext({sampleRate:16000});await session.context.audioWorklet.addModule('capture-worklet.js');
      if(session.aborted || capture !== session) {await releaseCapture(session);return;}
      session.source=session.context.createMediaStreamSource(session.stream);session.node=new AudioWorkletNode(session.context,'inkvoice-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});session.gain=session.context.createGain();session.gain.gain.value=0;
      session.node.port.onmessage=({data}) => {
        if(capture !== session || session.aborted) return;if(data.type === 'flushed') {session.flushResolve?.();return;}
        if(data.type === 'samples') {session.chunks.push(data.samples);session.levels.push(Math.min(1,Math.sqrt(Math.max(0,data.rms))*2.8));if(session.levels.length>bars.length) session.levels.shift();for(let i=0;i<bars.length;i++) bars[i].style.height=`${3+(session.levels[i] || 0)*21}px`;}
      };
      session.source.connect(session.node);session.node.connect(session.gain);session.gain.connect(session.context.destination);await session.context.resume();
      if(session.aborted || capture !== session) {await releaseCapture(session);return;}session.started=performance.now();
      session.timer=setInterval(() => {if(capture !== session || session.aborted) return;const elapsed=(performance.now()-session.started)/1000;$('record-time').textContent=duration(elapsed);if(elapsed>=300 && !session.maxNotified) {session.maxNotified=true;toast('已达到 5 分钟，正在识别本次录音。');invoke('toggleRecording');}},100);refreshMicrophones();
    } catch(error) {
      if(capture === session) capture=null;await releaseCapture(session);
      if(!session.aborted) {const message=error.name === 'NotAllowedError' ? '无法使用麦克风。请在 Windows 隐私设置中允许桌面应用访问麦克风。' : error.name === 'NotFoundError' || error.name === 'OverconstrainedError' ? '没有找到所选麦克风。请在设置中选择可用设备。' : `录音未能开始：${error.message}`;invoke('recordingError',{sessionId,message});showError(message);}
    }
  }
  async function stopCapture(sessionId,cancel=false) {
    const session=capture;if(!session || session.id !== sessionId) return;
    if(cancel) {session.aborted=true;capture=null;await releaseCapture(session);return;}
    if(session.stopping) return;session.stopping=true;
    try {
      clearInterval(session.timer);if(!session.node || !session.context) throw new Error('麦克风还未准备好，请稍后重试。');
      await new Promise(resolve => {const timer=setTimeout(resolve,150);session.flushResolve=() => {clearTimeout(timer);resolve();};session.node.port.postMessage({type:'flush'});});
      const sourceRate=session.context.sampleRate;await releaseCapture(session);if(session.aborted || capture !== session) return;capture=null;
      const mono=mergeChunks(session.chunks);if(!mono.length) throw new Error('没有录到声音，请检查麦克风并重试。');const samples=resample(mono,sourceRate,16000);await call('submitAudio',{sessionId,wav:encodeWav(samples,16000),durationSeconds:mono.length/sourceRate});
    } catch(error) {if(capture === session) capture=null;await releaseCapture(session);if(!session.aborted) invoke('recordingError',{sessionId,message:error.message});}
  }
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click',() => setView(button.dataset.view)));
  document.querySelector('.brand').addEventListener('click',event => {event.preventDefault();setView('home');});$('go-record').addEventListener('click',() => setView('home'));$('cloud-settings').addEventListener('click',() => {setView('settings');$('setting-api-key').focus();});
  $('record-button').addEventListener('click',() => invoke('toggleRecording'));$('cancel-job').addEventListener('click',() => invoke('cancel'));$('hide-window').addEventListener('click',() => invoke('hideWindow'));$('import-audio').addEventListener('click',() => invoke('importAudio'));$('retry-polish').addEventListener('click',() => invoke('retryPolish'));
  $('tab-final').addEventListener('click',() => {activeTab='text';updateText();});$('tab-raw').addEventListener('click',() => {activeTab='raw';updateText();});
  $('result-text').addEventListener('input',() => {
    if(activeTab !== 'text' || !shownResultId || state?.result?.id !== shownResultId || busyPhases.has(state?.phase)) {updateText();return;}
    const text=$('result-text').value;edits.text=text;edits.sourceText=text;state.result={...state.result,text};state.history=(state.history || []).map(item=>item.id === shownResultId ? {...item,text} : item);$('copy-result').disabled=!text.trim();
    call('updateDraft',{id:shownResultId,text}).catch(showError);
  });
  $('copy-result').addEventListener('click',async () => {try {await call('copyText',$('result-text').value);toast('已复制到剪贴板');} catch(error) {showError(error);}});
  document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click',async () => {try {await call('saveSettings',{polishMode:button.dataset.mode});if(button.dataset.mode !== 'basic' && !state?.providers?.geminiKeyAvailable) toast('云端模式需要 Gemini API 密钥，请前往设置。');} catch(error) {showError(error);}}));
  const dirty=() => {settingsDirty=true;$('settings-status').textContent='有未保存的更改。';};$('settings-form').addEventListener('input',dirty);$('settings-form').addEventListener('change',dirty);
  $('settings-form').addEventListener('submit',async event => {
    event.preventDefault();const patch={microphoneId:$('setting-microphone').value,hotkey:$('setting-hotkey').value,language:$('setting-language').value,outputLanguage:$('setting-output-language').value,autoInsert:$('setting-insert').checked,keepHistory:$('setting-history').checked,modelPath:$('setting-model').value.trim(),dictionary:$('setting-dictionary').value,geminiModel:$('setting-gemini-model').value.trim()};
    try {await call('saveSettings',patch);settingsDirty=false;$('settings-status').textContent='设置已保存。';toast('设置已保存');} catch(error) {$('settings-status').textContent=error.message;}
  });
  $('save-key').addEventListener('click',async () => {const key=$('setting-api-key').value.trim();if(!key) {toast('请先输入 API 密钥');return;}try {await call('setApiKey',key);$('setting-api-key').value='';toast('API 密钥已保存');} catch(error) {toast(error.message);}});
  $('open-data-folder').addEventListener('click',() => invoke('openDataFolder'));$('clear-history').addEventListener('click',() => $('confirm-dialog').showModal());$('confirm-no').addEventListener('click',() => $('confirm-dialog').close());$('confirm-yes').addEventListener('click',async () => {$('confirm-dialog').close();try {await call('clearHistory');toast('文字记录已清空');} catch(error) {showError(error);}});
  navigator.mediaDevices?.addEventListener?.('devicechange',refreshMicrophones);window.addEventListener('beforeunload',() => {if(capture) {capture.aborted=true;releaseCapture(capture);}});
  function runSelfTest() {
    const checks=[];const check=(name,passed) => {checks.push({name,passed:!!passed});if(!passed) throw new Error(`Renderer audio self-check failed: ${name}`);};
    const source=new Float32Array(48000);for(let i=0;i<source.length;i++) source[i]=.5*Math.sin(2*Math.PI*440*i/48000);
    const mono=resample(source,48000,16000);check('one-second 48k waveform becomes 16000 samples',mono.length===16000);check('resampling preserves signal and amplitude bounds',mono.every(Number.isFinite) && Math.max(...mono)>.49 && Math.max(...mono)<=.5 && Math.min(...mono)>=-.5);
    const constant=resample(new Float32Array(44100).fill(.25),44100,16000);check('44.1k conversion preserves DC level',constant.length===16000 && constant.every(value=>Math.abs(value-.25)<1e-6));
    const wav=encodeWav(mono,16000);const view=new DataView(wav);check('WAV header uses PCM16 mono 16kHz',view.getUint32(24,true)===16000 && view.getUint16(20,true)===1 && view.getUint16(22,true)===1 && view.getUint16(34,true)===16 && view.getUint32(40,true)===32000 && wav.byteLength===32044);
    const clipped=new DataView(encodeWav(new Float32Array([-2,0,2,NaN]),16000));check('PCM conversion clips extremes and sanitizes nonfinite samples',clipped.getInt16(44,true)===-32768 && clipped.getInt16(46,true)===0 && clipped.getInt16(48,true)===32767 && clipped.getInt16(50,true)===0);
    const ids=['record-button','import-audio','settings-form','history-list','result-text'];check('interactive application surfaces exist',ids.every(id=>!!$(id)));
    const originalTab=activeTab;activeTab='raw';updateText();check('raw transcript is read-only',$('result-text').readOnly);activeTab=originalTab;updateText();check('no untracked editable draft',shownResultId || $('result-text').readOnly);
    const originalState=state,originalId=shownResultId;state={...state,phase:'polishing',result:{id:'busy-readonly-check'}};shownResultId='busy-readonly-check';activeTab='text';updateText();check('active processing keeps final text read-only',$('result-text').readOnly);state=originalState;shownResultId=originalId;activeTab=originalTab;updateText();
    return {passed:true,checks,scope:'pure audio conversion and rendered control availability; actual capture tested separately'};
  }
  window.inkvoiceTest=Object.freeze({encodeWav,resample,runSelfTest});window.inkvoiceRendererReady=true;
  if(api) {api.onState(render);api.onRecordingCommand(command => {if(command.type === 'start') startCapture(command.sessionId);else if(command.type === 'stop') stopCapture(command.sessionId);else if(command.type === 'cancel') stopCapture(command.sessionId,true);});call('getState').then(render).catch(showError);} else showError('应用连接尚未就绪，请重新启动墨声。');
})();
