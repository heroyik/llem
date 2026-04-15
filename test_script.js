
window.onerror = function(msg, url, line, col, error) {
  document.body.innerHTML += '<div style="position:absolute;z-index:9999;background:red;color:white;padding:10px;top:0;left:0;right:0">ERROR: ' + msg + ' at line ' + line + '</div>';
};
window.addEventListener('unhandledrejection', function(event) {
  document.body.innerHTML += '<div style="position:absolute;z-index:9999;background:red;color:white;padding:10px;bottom:0;left:0;right:0">PROMISE REJECTION: ' + event.reason + '</div>';
});
try {
const vscode=acquireVsCodeApi(),chat=document.getElementById('chat'),input=document.getElementById('input'),
sendBtn=document.getElementById('sendBtn'),stopBtn=document.getElementById('stopBtn'),
modelSel=document.getElementById('modelSel'),newChatBtn=document.getElementById('newChatBtn'),settingsBtn=document.getElementById('settingsBtn'),brainBtn=document.getElementById('brainBtn'),
attachBtn=document.getElementById('attachBtn'),fileInput=document.getElementById('fileInput'),attachPreview=document.getElementById('attachPreview'),
thinkingBar=document.getElementById('thinkingBar');
let loader=null,sending=false,pendingFiles=[];

/* Syntax Highlighting (lightweight) */
function highlight(code,lang){
  let h=esc(code);
  h=h.replace(/(\\/\\/[^\\n]*)/g,'<span class="cm">$1</span>');
  h=h.replace(/(#[^\\n]*)/g,'<span class="cm">$1</span>');
  h=h.replace(/(\\/\\*[\\s\\S]*?\\*\\/)/g,'<span class="cm">$1</span>');
  h=h.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g,'<span class="str">$1</span>');
  h=h.replace(/\\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\\b/g,'<span class="kw">$1</span>');
  h=h.replace(/\\b(\\d+\\.?\\d*)\\b/g,'<span class="num">$1</span>');
  h=h.replace(/\\b(True|False|None|true|false|null|undefined|NaN)\\b/g,'<span class="num">$1</span>');
  h=h.replace(/\\b(String|Number|Boolean|Array|Object|Map|Set|Promise|void|int|float|str|list|dict|tuple)\\b/g,'<span class="type">$1</span>');
  h=h.replace(/([=!&lt;&gt;+\\-*/%|&amp;^~?:]+)/g,'<span class="op">$1</span>');
  return h;
}

/* Clipboard Paste (Ctrl+V images) */
input.addEventListener('paste',(e)=>{
  const items=e.clipboardData&&e.clipboardData.items;
  if(!items)return;
  for(const item of items){
    if(item.type.startsWith('image/')){
      e.preventDefault();
      const file=item.getAsFile();
      if(!file)return;
      const reader=new FileReader();
      reader.onload=()=>{
        const base64=reader.result.split(',')[1];
        pendingFiles.push({name:'clipboard-image.png',type:file.type,data:base64});
        renderPreview();
      };
      reader.readAsDataURL(file);
      return;
    }
  }
});
vscode.postMessage({type:'getModels'});
setTimeout(()=>vscode.postMessage({type:'ready'}),300);
input.addEventListener('input',()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px'});
function getTime(){return new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}
function esc(s){const d=document.createElement('div');d.innerText=s;return d.innerHTML}
function fmt(t){
  if(t.lastIndexOf('<create_file') > t.lastIndexOf('</create_file>')) t += '</create_file>';
  if(t.lastIndexOf('<edit_file') > t.lastIndexOf('</edit_file>')) t += '</edit_file>';
  if(t.lastIndexOf('<run_command') > t.lastIndexOf('</run_command>')) t += '</run_command>';
  if((t.match(/\`\`\`/g)||[]).length % 2 !== 0) t += '\\n\`\`\`';

  const blocks = [];
  function pushB(h){ blocks.push(h); return '__B' + (blocks.length-1) + '__'; }
  t=t.replace(/<create_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/create_file>/g,(_,p,c)=>pushB('<div class="file-badge">\u{1F4C1} '+esc(p)+' \u2014 \uC790\uB3D9 \uC0DD\uC131\uB428</div><div class="code-wrap"><pre><code>'+esc(c)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>'));
  t=t.replace(/<edit_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/edit_file>/g,(_,p,c)=>pushB('<div class="edit-badge">\u270F\uFE0F '+esc(p)+' \u2014 \uD3B8\uC9D1\uB428</div><div class="code-wrap"><pre><code>'+esc(c)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>'));
  t=t.replace(/<run_command>([\\s\\S]*?)<\\/run_command>/g,(_,c)=>pushB('<div class="cmd-badge">\u25B6 '+esc(c)+'</div>'));
  t=t.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g,(_,lang,c)=>{const l=lang||'code';return pushB('<div class="code-wrap"><span class="code-lang">'+esc(l)+'</span><pre><code>'+highlight(c,l)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>');});
  t=t.replace(/\`([^\`]+)\`/g,(_,c)=>pushB('<code>'+esc(c)+'</code>'));
  t=esc(t);
  t=t.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');
  t=t.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');
  t=t.replace(/__B(\\d+)__/g, (_,i)=>blocks[i]);
  return t;
}
function copyCode(btn){const code=btn.parentElement.querySelector('code');if(!code)return;navigator.clipboard.writeText(code.innerText).then(()=>{btn.textContent='\u2713 Copied';btn.classList.add('copied');setTimeout(()=>{btn.textContent='Copy';btn.classList.remove('copied')},1500)})}
function addMsg(text,role){
  const isUser=role==='user',isErr=role==='error';
  const el=document.createElement('div');el.className='msg'+(isUser?' msg-user':'')+(isErr?' msg-error':'');
  const head=document.createElement('div');head.className='msg-head';
  head.innerHTML=(isUser?'<div class="av av-user">\u{1F464}</div><span>You</span>':'<div class="av av-ai">\u2726</div><span>Connect AI</span>')+'<span class="msg-time">'+getTime()+'</span>';
  const body=document.createElement('div');body.className='msg-body';
  if(isUser){body.innerText=text}else{body.innerHTML=fmt(text)}
  el.appendChild(head);el.appendChild(body);chat.appendChild(el);chat.scrollTop=chat.scrollHeight;
}
function showLoader(){loader=document.createElement('div');loader.className='msg';loader.innerHTML='<div class="msg-head"><div class="av av-ai">\u2726</div><span>Connect AI</span><span class="msg-time">'+getTime()+'</span></div><div class="loading-wrap"><div class="loading-dots"><span></span><span></span><span></span></div><span class="loading-text">\uC0DD\uAC01\uD558\uB294 \uC911...</span></div>';chat.appendChild(loader);chat.scrollTop=chat.scrollHeight;thinkingBar.classList.add('active')}
function hideLoader(){if(loader&&loader.parentNode)loader.parentNode.removeChild(loader);loader=null;thinkingBar.classList.remove('active')}
function setSending(v){sending=v;sendBtn.disabled=v;stopBtn.classList.toggle('visible',v);input.disabled=v;if(!v){input.focus();thinkingBar.classList.remove('active')}}
function send(){
  const text=input.value.trim();
  if((!text&&pendingFiles.length===0)||sending)return;
  document.body.classList.remove('init');
  const w=document.querySelector('.welcome');if(w)w.remove();
  document.querySelectorAll('.quick-actions').forEach(e=>e.remove());
  const displayText=text+(pendingFiles.length>0?'
\u{1F4CE} '+pendingFiles.map(f=>f.name).join(', '):'');
  addMsg(displayText,'user');
  input.value='';input.style.height='auto';setSending(true);showLoader();
  if(pendingFiles.length>0){
    vscode.postMessage({type:'promptWithFile',value:text||'\uC774 \uD30C\uC77C\uC744 \uBD84\uC11D\uD574\uC8FC\uC138\uC694.',model:modelSel.value,files:pendingFiles});
    pendingFiles=[];attachPreview.innerHTML='';attachPreview.classList.remove('visible');
  } else {
    vscode.postMessage({type:'prompt',value:text,model:modelSel.value});
  }
}

/* Attachment Logic */
attachBtn.addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',()=>{
  const files=Array.from(fileInput.files);
  files.forEach(file=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const base64=reader.result.split(',')[1];
      pendingFiles.push({name:file.name,type:file.type,data:base64});
      renderPreview();
    };
    reader.readAsDataURL(file);
  });
  fileInput.value='';
});
function renderPreview(){
  attachPreview.innerHTML='';
  if(pendingFiles.length===0){attachPreview.classList.remove('visible');return;}
  attachPreview.classList.add('visible');
  pendingFiles.forEach((f,i)=>{
    const chip=document.createElement('div');chip.className='attach-chip';
    const isImg=f.type.startsWith('image/');
    if(isImg){
      const thumb=document.createElement('img');thumb.className='attach-thumb';thumb.src='data:'+f.type+';base64,'+f.data;chip.appendChild(thumb);
    } else {
      const icon=document.createElement('span');icon.className='chip-icon';icon.textContent=f.type.startsWith('audio/')?'\u{1F3A7}':'\u{1F4C4}';chip.appendChild(icon);
    }
    const nm=document.createElement('span');nm.className='chip-name';nm.textContent=f.name;chip.appendChild(nm);
    const rm=document.createElement('span');rm.className='chip-remove';rm.textContent='\u2715';
    rm.addEventListener('click',()=>{pendingFiles.splice(i,1);renderPreview();});
    chip.appendChild(rm);
    attachPreview.appendChild(chip);
  });
}
document.addEventListener('click',e=>{if(e.target.classList.contains('qa-btn')){const p=e.target.getAttribute('data-prompt');if(p){input.value=p;send()}}});
sendBtn.addEventListener('click',send);
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}});
newChatBtn.addEventListener('click',()=>vscode.postMessage({type:'newChat'}));
settingsBtn.addEventListener('click',()=>vscode.postMessage({type:'openSettings'}));
brainBtn.addEventListener('click',()=>vscode.postMessage({type:'syncBrain'}));
stopBtn.addEventListener('click',()=>{vscode.postMessage({type:'stopGeneration'});hideLoader();setSending(false);if(streamBody){streamBody.classList.remove('stream-active')}streamEl=null;streamBody=null;});
let streamEl=null,streamBody=null;
window.addEventListener('message',e=>{const msg=e.data;switch(msg.type){
  case 'response':hideLoader();setSending(false);addMsg(msg.value,'ai');break;
  case 'error':hideLoader();setSending(false);addMsg(msg.value,'error');break;
  case 'streamStart':{
    hideLoader();
    streamEl=document.createElement('div');streamEl.className='msg';
    const h=document.createElement('div');h.className='msg-head';
    h.innerHTML='<div class="av av-ai">\u2726</div><span>Connect AI</span><span class="msg-time">'+getTime()+'</span>';
    streamBody=document.createElement('div');streamBody.className='msg-body stream-active';
    streamEl.appendChild(h);streamEl.appendChild(streamBody);chat.appendChild(streamEl);chat.scrollTop=chat.scrollHeight;
    break;}
  case 'streamChunk':{
    if(streamBody){streamBody.innerHTML=fmt(streamBody._raw=(streamBody._raw||'')+msg.value);chat.scrollTop=chat.scrollHeight;}
    break;}
  case 'streamEnd':{
    if(streamBody)streamBody.classList.remove('stream-active');
    /* Add regenerate button */
    if(streamEl){
      const rb=document.createElement('button');rb.className='regen-btn';rb.innerHTML='\u{1F504} Regenerate';
      rb.addEventListener('click',()=>{rb.remove();vscode.postMessage({type:'regenerate'});showLoader();setSending(true);});
      streamEl.appendChild(rb);
    }
    setSending(false);streamEl=null;streamBody=null;
    break;}
  case 'modelsList':modelSel.innerHTML='';msg.value.forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;modelSel.appendChild(o)});break;
  case 'clearChat':
    document.body.classList.add('init');
    chat.innerHTML='<div class="welcome"><div class="welcome-logo">\u2726</div><div class="welcome-title">Connect AI</div><div class="welcome-sub">\uBCF4\uC548 \xB7 \uBE44\uC6A9\uCD5C\uC801\uD654 \xB7 \uC9C0\uC2DD\uC5F0\uACB0<br>\uD504\uB85C\uC81D\uD2B8\uB97C \uC774\uD574\uD558\uACE0, \uCF54\uB4DC\uB97C \uC791\uC131\uD558\uACE0, \uC2E4\uD589\uD569\uB2C8\uB2E4.</div></div>';
    break;
  case 'restoreMessages':
    chat.innerHTML='';
    if(msg.value&&msg.value.length>0){
      document.body.classList.remove('init');
      msg.value.forEach(m=>addMsg(m.text,m.role));
    } else {
      document.body.classList.add('init');
      chat.innerHTML='<div class="welcome"><div class="welcome-logo">\u2726</div><div class="welcome-title">Connect AI</div><div class="welcome-sub">\uBCF4\uC548 \xB7 \uBE44\uC6A9\uCD5C\uC801\uD654 \xB7 \uC9C0\uC2DD\uC5F0\uACB0<br>\uD504\uB85C\uC81D\uD2B8\uB97C \uC774\uD574\uD558\uACE0, \uCF54\uB4DC\uB97C \uC791\uC131\uD558\uACE0, \uC2E4\uD589\uD569\uB2C8\uB2E4.</div></div>';
    }
    break;
  case 'focusInput':input.focus();break;
  case 'injectPrompt':input.value=msg.value;input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px';send();break;
} });
} catch(err) {
  document.body.innerHTML = '<div style="color:#ff4444;padding:20px;background:#111;height:100%;font-size:14px;overflow:auto;"><h2>\u26A0\uFE0F WEBVIEW JS CRASH</h2><pre>' + err.name + ': ' + err.message + '\\n' + err.stack + '</pre></div>';
}
