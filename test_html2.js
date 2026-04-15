const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Connect AI</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0a0a0c;--bg2:#111114;--surface:rgba(22,22,28,.75);--surface2:rgba(38,38,46,.6);
  --border:rgba(255,255,255,.06);--border2:rgba(255,255,255,.1);
  --text:#b0b0be;--text-bright:#f0f0f5;--text-dim:#55556a;
  --accent:#7c6aff;--accent2:#e040fb;--accent3:#00e5ff;
  --accent-glow:rgba(124,106,255,.2);--accent2-glow:rgba(224,64,251,.15);
  --input-bg:rgba(14,14,18,.9);--code-bg:#08080c;
  --green:#00e676;--yellow:#ffab40;--cyan:#00e5ff;--red:#ff5252;
}
html,body{height:100%;font-family:'SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:13px;background:var(--bg);color:var(--text);display:flex;flex-direction:column;overflow:hidden}

/* AURORA BACKGROUND */
body::before{content:'';position:fixed;top:-50%;left:-50%;width:200%;height:200%;background:radial-gradient(ellipse at 20% 50%,rgba(124,106,255,.06) 0%,transparent 50%),radial-gradient(ellipse at 80% 20%,rgba(224,64,251,.04) 0%,transparent 50%),radial-gradient(ellipse at 50% 80%,rgba(0,229,255,.03) 0%,transparent 50%);animation:aurora 20s ease-in-out infinite;z-index:0;pointer-events:none}
@keyframes aurora{0%,100%{transform:translate(0,0) rotate(0deg)}33%{transform:translate(2%,-1%) rotate(.5deg)}66%{transform:translate(-1%,2%) rotate(-.5deg)}}

/* HEADER */
.header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:rgba(10,10,12,.8);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--border);flex-shrink:0;position:relative;z-index:10}
.header::after{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent 5%,var(--accent) 30%,var(--accent2) 50%,var(--accent3) 70%,transparent 95%);opacity:.5;animation:headerGlow 4s ease-in-out infinite alternate}
@keyframes headerGlow{0%{opacity:.3}100%{opacity:.6}}
.thinking-bar{height:2px;background:transparent;position:relative;overflow:hidden;flex-shrink:0;z-index:10}
.thinking-bar.active{background:rgba(124,106,255,.1)}
.thinking-bar.active::after{content:'';position:absolute;top:0;left:-40%;width:40%;height:100%;background:linear-gradient(90deg,transparent,var(--accent),var(--accent2),var(--accent3),transparent);animation:thinkSlide 1.5s ease-in-out infinite}
@keyframes thinkSlide{0%{left:-40%}100%{left:100%}}
.header-left{display:flex;align-items:center;gap:8px}
.logo{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;box-shadow:0 0 15px rgba(124,106,255,.4),0 0 30px rgba(224,64,251,.15);animation:logoPulse 3s ease-in-out infinite;position:relative}
.logo::after{content:'';position:absolute;inset:-2px;border-radius:10px;background:linear-gradient(135deg,var(--accent),var(--accent2),var(--accent3));opacity:.3;filter:blur(4px);animation:logoPulse 3s ease-in-out infinite}
@keyframes logoPulse{0%,100%{box-shadow:0 0 15px rgba(124,106,255,.4),0 0 30px rgba(224,64,251,.15)}50%{box-shadow:0 0 20px rgba(124,106,255,.6),0 0 40px rgba(224,64,251,.25)}}
.brand{font-weight:800;font-size:14px;color:var(--text-bright);letter-spacing:-.5px;background:linear-gradient(135deg,#fff 40%,var(--accent) 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.header-right{display:flex;align-items:center;gap:5px}
select{background:rgba(22,22,28,.9);color:var(--text-bright);border:1px solid var(--border2);padding:5px 8px;border-radius:8px;font-size:10px;font-family:inherit;cursor:pointer;outline:none;max-width:120px;transition:all .3s;backdrop-filter:blur(8px)}
select:hover,select:focus{border-color:var(--accent);box-shadow:0 0 12px var(--accent-glow)}
.btn-icon{background:rgba(22,22,28,.7);border:1px solid var(--border2);color:var(--text-dim);width:28px;height:28px;border-radius:8px;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .3s;backdrop-filter:blur(8px);position:relative;overflow:hidden}
.btn-icon::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,var(--accent-glow),var(--accent2-glow));opacity:0;transition:opacity .3s}
.btn-icon:hover{color:var(--text-bright);border-color:var(--accent);transform:translateY(-1px);box-shadow:0 4px 15px var(--accent-glow)}
.btn-icon:hover::before{opacity:1}

/* CHAT */
.chat{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:16px;position:relative;z-index:1}
.chat::-webkit-scrollbar{width:2px}.chat::-webkit-scrollbar-track{background:transparent}.chat::-webkit-scrollbar-thumb{background:var(--accent);border-radius:2px;opacity:.5}

/* MESSAGES */
.msg{display:flex;flex-direction:column;gap:5px;animation:msgIn .5s cubic-bezier(.16,1,.3,1)}
.msg-head{display:flex;align-items:center;gap:7px;font-weight:600;font-size:11px;color:var(--text)}
.msg-time{font-weight:400;font-size:9px;color:var(--text-dim);margin-left:auto;opacity:.6}
.av{width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0}
.av-user{background:var(--surface2);color:var(--text);border:1px solid var(--border2)}
.av-ai{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 0 10px rgba(124,106,255,.3)}
.msg-body{padding-left:29px;line-height:1.75;color:var(--text);white-space:pre-wrap;word-break:break-word;font-size:13px}
.msg-user .msg-body{background:var(--surface);border:1px solid var(--border2);border-radius:14px;padding:10px 14px;margin-left:29px;color:var(--text-bright);backdrop-filter:blur(8px)}
.msg-body pre{background:var(--code-bg);border:1px solid var(--border2);border-radius:10px;padding:14px 16px;overflow-x:auto;margin:8px 0;font-size:12px;line-height:1.6;color:#c9d1d9;position:relative}
.msg-body pre::-webkit-scrollbar{height:6px}
.msg-body pre::-webkit-scrollbar-track{background:rgba(0,0,0,.2);border-radius:4px}
.msg-body pre::-webkit-scrollbar-thumb{background:rgba(124,106,255,.3);border-radius:4px}
.msg-body pre::-webkit-scrollbar-thumb:hover{background:rgba(124,106,255,.6)}
.msg-body code{font-family:'SF Mono','JetBrains Mono','Fira Code','Menlo',monospace;font-size:11.5px}
.msg-body :not(pre)>code{background:rgba(124,106,255,.1);color:var(--accent);padding:2px 7px;border-radius:5px;border:1px solid rgba(124,106,255,.15)}
.msg-body a{color:var(--accent);text-decoration:none}
.msg-body a:hover{text-decoration:underline}
.code-wrap{position:relative}
.code-lang{position:absolute;top:0;left:14px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;padding:2px 10px;border-radius:0 0 6px 6px;font-size:9px;font-family:'SF Mono',monospace;text-transform:uppercase;letter-spacing:.5px;font-weight:600}
.copy-btn{position:absolute;top:8px;right:8px;background:var(--surface2);border:1px solid var(--border2);color:var(--text-dim);padding:4px 12px;border-radius:6px;font-size:10px;cursor:pointer;opacity:0;transition:all .3s;font-family:inherit;z-index:1;backdrop-filter:blur(8px)}
.code-wrap:hover .copy-btn{opacity:1}.copy-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent);box-shadow:0 0 12px var(--accent-glow)}
.copy-btn.copied{background:var(--green);color:#fff;border-color:var(--green);opacity:1}

/* BADGES */
.file-badge{background:rgba(255,171,64,.05);border:1px solid rgba(255,171,64,.2);border-radius:10px 10px 0 0;border-bottom:none;padding:8px 14px;font-size:11px;font-weight:700;color:var(--yellow);display:flex;align-items:center;gap:6px;backdrop-filter:blur(8px)}
.edit-badge{background:rgba(0,229,255,.05);border:1px solid rgba(0,229,255,.2);border-radius:10px 10px 0 0;border-bottom:none;padding:8px 14px;font-size:11px;font-weight:700;color:var(--cyan);display:flex;align-items:center;gap:6px;backdrop-filter:blur(8px)}
.cmd-badge{background:rgba(124,106,255,.05);border:1px solid rgba(124,106,255,.25);border-radius:10px;padding:10px 14px;margin:8px 0;font-size:12px;color:var(--accent);font-family:'SF Mono','Menlo',monospace;display:flex;align-items:center;gap:8px;backdrop-filter:blur(8px)}
.msg-error .msg-body{color:var(--red);text-shadow:0 0 20px rgba(255,82,82,.2)}

/* WELCOME */
.welcome{text-align:center;padding:0 20px 20px;position:relative}
.welcome-logo{width:56px;height:56px;border-radius:16px;margin:0 auto 16px;background:linear-gradient(135deg,var(--accent),var(--accent2),var(--accent3));display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;box-shadow:0 0 40px rgba(124,106,255,.35),0 0 80px rgba(224,64,251,.15);animation:welcomeFloat 4s ease-in-out infinite;position:relative}
.welcome-logo::before{content:'';position:absolute;inset:-4px;border-radius:20px;background:conic-gradient(from 0deg,var(--accent),var(--accent2),var(--accent3),var(--accent));opacity:.2;filter:blur(8px);animation:spin 8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes welcomeFloat{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-6px) scale(1.03)}}
.welcome-title{font-size:22px;font-weight:900;letter-spacing:-1px;background:linear-gradient(135deg,#fff,var(--accent),var(--accent2));background-size:200% 200%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:gradText 5s ease infinite;margin-bottom:8px}
@keyframes gradText{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
.welcome-sub{color:var(--text-dim);font-size:12px;line-height:1.7;margin-bottom:18px;letter-spacing:-.2px}

/* LOADING */
.loading-wrap{padding-left:29px;padding-top:6px;display:flex;align-items:center;gap:10px}
.loading-dots{display:flex;gap:4px}
.loading-dots span{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:dotBounce 1.4s ease-in-out infinite}
.loading-dots span:nth-child(2){animation-delay:.2s;background:var(--accent2)}
.loading-dots span:nth-child(3){animation-delay:.4s;background:var(--accent3)}
@keyframes dotBounce{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1.2);opacity:1}}
.loading-text{font-size:11px;color:var(--text-dim);animation:pulse 2s ease-in-out infinite;letter-spacing:.3px}

/* INPUT */
.input-wrap{padding:8px 14px 14px;flex-shrink:0;position:relative;z-index:1}
.input-box{background:var(--input-bg);border:1px solid var(--border2);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;transition:all .3s;position:relative;backdrop-filter:blur(12px)}
.input-box:focus-within{border-color:rgba(124,106,255,.4);box-shadow:0 0 24px rgba(124,106,255,.12);animation:focusPulse 3s infinite}
@keyframes focusPulse{0%,100%{box-shadow:0 0 20px rgba(124,106,255,.08)}50%{box-shadow:0 0 28px rgba(124,106,255,.18)}}
textarea{width:100%;background:transparent;border:none;color:var(--text-bright);font-family:inherit;font-size:13px;line-height:1.5;resize:none;outline:none;min-height:22px;max-height:150px}
textarea::placeholder{color:var(--text-dim)}
.input-footer{display:flex;align-items:center;justify-content:space-between}
.input-hint{font-size:10px;color:var(--text-dim);opacity:.5}
.input-btns{display:flex;gap:5px}
.send-btn{background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;color:#fff;width:32px;height:32px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;transition:all .2s;box-shadow:0 2px 12px rgba(124,106,255,.35);position:relative;overflow:hidden}
.send-btn::after{content:'';position:absolute;inset:0;background:linear-gradient(135deg,transparent,rgba(255,255,255,.15));opacity:0;transition:opacity .3s}
.send-btn:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 6px 24px rgba(124,106,255,.45)}
.send-btn:hover::after{opacity:1}
.send-btn:active{transform:scale(.92)}.send-btn:disabled{opacity:.2;cursor:not-allowed;transform:none;box-shadow:none}
.stop-btn{background:var(--red);border:none;color:#fff;width:32px;height:32px;border-radius:10px;cursor:pointer;display:none;align-items:center;justify-content:center;font-size:11px;box-shadow:0 0 12px rgba(255,82,82,.3)}
.stop-btn.visible{display:flex}
@keyframes msgIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
.stream-active{position:relative}
.stream-active::after{content:'';display:inline-block;width:2px;height:14px;background:var(--accent);margin-left:2px;animation:blink .6s step-end infinite;vertical-align:text-bottom;border-radius:1px;box-shadow:0 0 6px var(--accent)}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
.stream-active .code-wrap:last-child {
  border: 1px solid var(--accent);
  animation: codePulse 2s infinite;
}
.stream-active .code-wrap:last-child pre {
  box-shadow: inset 0 0 20px rgba(124,106,255,0.05);
}
@keyframes codePulse {
  0%, 100% { box-shadow: 0 0 15px var(--accent-glow); }
  50% { box-shadow: 0 0 35px var(--accent2-glow); border-color: var(--accent2); }
}
.main-view{flex:1;display:flex;flex-direction:column;overflow:hidden;transition:all .5s cubic-bezier(.16,1,.3,1)}
body.init .main-view{justify-content:center;margin-top:-6vh}
body.init .chat{flex:0 0 auto;overflow:visible;padding-bottom:15px}
body.init .input-wrap{max-width:680px;width:100%;margin:0 auto;transform:none;transition:all .5s cubic-bezier(.16,1,.3,1)}

/* ATTACHMENT */
.attach-btn{background:transparent;border:1px solid var(--border2);color:var(--text-dim);width:32px;height:32px;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .3s;flex-shrink:0}
.attach-btn:hover{color:var(--accent);border-color:var(--accent);box-shadow:0 0 12px var(--accent-glow);transform:translateY(-1px)}
.attach-preview{display:none;gap:6px;padding:0 0 6px;flex-wrap:wrap}
.attach-preview.visible{display:flex}
.attach-chip{display:flex;align-items:center;gap:5px;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:4px 10px;font-size:10px;color:var(--text);animation:msgIn .3s ease}
.attach-chip .chip-icon{font-size:12px}
.attach-chip .chip-name{max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.attach-chip .chip-remove{cursor:pointer;color:var(--text-dim);font-size:12px;margin-left:2px;transition:color .2s}
.attach-chip .chip-remove:hover{color:var(--red)}
.attach-thumb{width:28px;height:28px;border-radius:5px;object-fit:cover;border:1px solid var(--border2)}

/* REGENERATE BUTTON */
.regen-btn{display:inline-flex;align-items:center;gap:4px;background:transparent;border:1px solid var(--border2);color:var(--text-dim);padding:4px 12px;border-radius:8px;font-size:10px;cursor:pointer;transition:all .3s;font-family:inherit;margin-top:6px;margin-left:29px}
.regen-btn:hover{color:var(--accent);border-color:var(--accent);box-shadow:0 0 12px var(--accent-glow)}

/* SYNTAX HIGHLIGHTING */
.msg-body pre .kw{color:#c792ea}
.msg-body pre .str{color:#c3e88d}
.msg-body pre .num{color:#f78c6c}
.msg-body pre .cm{color:#546e7a;font-style:italic}
.msg-body pre .fn{color:#82aaff}
.msg-body pre .tag{color:#f07178}
.msg-body pre .attr{color:#ffcb6b}
.msg-body pre .op{color:#89ddff}
.msg-body pre .type{color:#ffcb6b}
</style></head><body class="init">
<div class="header"><div class="header-left"><div class="logo">\u2726</div><span class="brand">Connect AI</span></div><div class="header-right"><select id="modelSel"></select><button class="btn-icon" id="brainBtn" title="Second Brain">\ud83e\udde0</button><button class="btn-icon" id="settingsBtn" title="Settings">\u2699\ufe0f</button><button class="btn-icon" id="newChatBtn" title="New Chat">+</button></div></div>
<div class="thinking-bar" id="thinkingBar"></div>
<div class="main-view" id="mainView">
<div class="chat" id="chat">
<div class="welcome">
<div class="welcome-logo">\u2726</div>
<div class="welcome-title">Connect AI</div>
<div class="welcome-sub">\ubcf4\uc548 \u00b7 \ube44\uc6a9\ucd5c\uc801\ud654 \u00b7 \uc9c0\uc2dd\uc5f0\uacb0<br>\ud504\ub85c\uc81d\ud2b8\ub97c \uc774\ud574\ud558\uace0, \ucf54\ub4dc\ub97c \uc791\uc131\ud558\uace0, \uc2e4\ud589\ud569\ub2c8\ub2e4.</div>
</div></div>
<div class="input-wrap"><div class="input-box">
<div class="attach-preview" id="attachPreview"></div>
<textarea id="input" rows="1" placeholder="\ubb34\uc5c7\uc744 \ub9cc\ub4e4\uc5b4 \ub4dc\ub9b4\uae4c\uc694?"></textarea>
<div class="input-footer"><span class="input-hint">Enter \uc804\uc1a1 \u00b7 Shift+Enter \uc904\ubc14\uafc8</span>
<div class="input-btns"><button class="attach-btn" id="attachBtn" title="\ud30c\uc77c \ucca8\ubd80">+</button><button class="stop-btn" id="stopBtn">\u25a0</button><button class="send-btn" id="sendBtn">\u2191</button></div></div></div>
<input type="file" id="fileInput" multiple accept="image/*,audio/*,.txt,.md,.csv,.json,.js,.ts,.html,.css,.py,.java,.rs,.go,.yaml,.yml,.xml,.toml" hidden></div>
</div>
<script>
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
  h=h.replace(/(\\/\\/[^\\n]*)/g,'<span class=\"cm\">$1</span>');
  h=h.replace(/(#[^\\n]*)/g,'<span class=\"cm\">$1</span>');
  h=h.replace(/(\\/\\*[\\s\\S]*?\\*\\/)/g,'<span class=\"cm\">$1</span>');
  h=h.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g,'<span class=\"str\">$1</span>');
  h=h.replace(/\\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\\b/g,'<span class=\"kw\">$1</span>');
  h=h.replace(/\\b(\\d+\\.?\\d*)\\b/g,'<span class=\"num\">$1</span>');
  h=h.replace(/\\b(True|False|None|true|false|null|undefined|NaN)\\b/g,'<span class=\"num\">$1</span>');
  h=h.replace(/\\b(String|Number|Boolean|Array|Object|Map|Set|Promise|void|int|float|str|list|dict|tuple)\\b/g,'<span class=\"type\">$1</span>');
  h=h.replace(/([=!&lt;&gt;+\\-*/%|&amp;^~?:]+)/g,'<span class=\"op\">$1</span>');
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
  if((t.match(/\x60\x60\x60/g)||[]).length % 2 !== 0) t += '\\n\x60\x60\x60';

  const blocks = [];
  function pushB(h){ blocks.push(h); return '__B' + (blocks.length-1) + '__'; }
  t=t.replace(/<create_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/create_file>/g,(_,p,c)=>pushB('<div class="file-badge">\ud83d\udcc1 '+esc(p)+' \u2014 \uc790\ub3d9 \uc0dd\uc131\ub428</div><div class="code-wrap"><pre><code>'+esc(c)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>'));
  t=t.replace(/<edit_file\\s+path="([^"]+)">([\\s\\S]*?)<\\/edit_file>/g,(_,p,c)=>pushB('<div class="edit-badge">\u270f\ufe0f '+esc(p)+' \u2014 \ud3b8\uc9d1\ub428</div><div class="code-wrap"><pre><code>'+esc(c)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>'));
  t=t.replace(/<run_command>([\\s\\S]*?)<\\/run_command>/g,(_,c)=>pushB('<div class="cmd-badge">\u25b6 '+esc(c)+'</div>'));
  t=t.replace(/\x60\x60\x60(\\w*)\\n([\\s\\S]*?)\x60\x60\x60/g,(_,lang,c)=>{const l=lang||'code';return pushB('<div class="code-wrap"><span class="code-lang">'+esc(l)+'</span><pre><code>'+highlight(c,l)+'</code></pre><button class="copy-btn" onclick="copyCode(this)">Copy</button></div>');});
  t=t.replace(/\x60([^\x60]+)\x60/g,(_,c)=>pushB('<code>'+esc(c)+'</code>'));
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
  head.innerHTML=(isUser?'<div class="av av-user">\ud83d\udc64</div><span>You</span>':'<div class="av av-ai">\u2726</div><span>Connect AI</span>')+'<span class="msg-time">'+getTime()+'</span>';
  const body=document.createElement('div');body.className='msg-body';
  if(isUser){body.innerText=text}else{body.innerHTML=fmt(text)}
  el.appendChild(head);el.appendChild(body);chat.appendChild(el);chat.scrollTop=chat.scrollHeight;
}
function showLoader(){loader=document.createElement('div');loader.className='msg';loader.innerHTML='<div class="msg-head"><div class="av av-ai">\u2726</div><span>Connect AI</span><span class="msg-time">'+getTime()+'</span></div><div class="loading-wrap"><div class="loading-dots"><span></span><span></span><span></span></div><span class="loading-text">\uc0dd\uac01\ud558\ub294 \uc911...</span></div>';chat.appendChild(loader);chat.scrollTop=chat.scrollHeight;thinkingBar.classList.add('active')}
function hideLoader(){if(loader&&loader.parentNode)loader.parentNode.removeChild(loader);loader=null;thinkingBar.classList.remove('active')}
function setSending(v){sending=v;sendBtn.disabled=v;stopBtn.classList.toggle('visible',v);input.disabled=v;if(!v){input.focus();thinkingBar.classList.remove('active')}}
function send(){
  const text=input.value.trim();
  if((!text&&pendingFiles.length===0)||sending)return;
  document.body.classList.remove('init');
  const w=document.querySelector('.welcome');if(w)w.remove();
  document.querySelectorAll('.quick-actions').forEach(e=>e.remove());
  const displayText=text+(pendingFiles.length>0?'\n\ud83d\udcce '+pendingFiles.map(f=>f.name).join(', '):'');
  addMsg(displayText,'user');
  input.value='';input.style.height='auto';setSending(true);showLoader();
  if(pendingFiles.length>0){
    vscode.postMessage({type:'promptWithFile',value:text||'\uc774 \ud30c\uc77c\uc744 \ubd84\uc11d\ud574\uc8fc\uc138\uc694.',model:modelSel.value,files:pendingFiles});
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
      const icon=document.createElement('span');icon.className='chip-icon';icon.textContent=f.type.startsWith('audio/')?'\ud83c\udfa7':'\ud83d\udcc4';chip.appendChild(icon);
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
      const rb=document.createElement('button');rb.className='regen-btn';rb.innerHTML='\ud83d\udd04 Regenerate';
      rb.addEventListener('click',()=>{rb.remove();vscode.postMessage({type:'regenerate'});showLoader();setSending(true);});
      streamEl.appendChild(rb);
    }
    setSending(false);streamEl=null;streamBody=null;
    break;}
  case 'modelsList':modelSel.innerHTML='';msg.value.forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;modelSel.appendChild(o)});break;
  case 'clearChat':
    document.body.classList.add('init');
    chat.innerHTML='<div class="welcome"><div class="welcome-logo">\u2726</div><div class="welcome-title">Connect AI</div><div class="welcome-sub">\ubcf4\uc548 \u00b7 \ube44\uc6a9\ucd5c\uc801\ud654 \u00b7 \uc9c0\uc2dd\uc5f0\uacb0<br>\ud504\ub85c\uc81d\ud2b8\ub97c \uc774\ud574\ud558\uace0, \ucf54\ub4dc\ub97c \uc791\uc131\ud558\uace0, \uc2e4\ud589\ud569\ub2c8\ub2e4.</div></div>';
    break;
  case 'restoreMessages':
    chat.innerHTML='';
    if(msg.value&&msg.value.length>0){
      document.body.classList.remove('init');
      msg.value.forEach(m=>addMsg(m.text,m.role));
    } else {
      document.body.classList.add('init');
      chat.innerHTML='<div class="welcome"><div class="welcome-logo">\u2726</div><div class="welcome-title">Connect AI</div><div class="welcome-sub">\ubcf4\uc548 \u00b7 \ube44\uc6a9\ucd5c\uc801\ud654 \u00b7 \uc9c0\uc2dd\uc5f0\uacb0<br>\ud504\ub85c\uc81d\ud2b8\ub97c \uc774\ud574\ud558\uace0, \ucf54\ub4dc\ub97c \uc791\uc131\ud558\uace0, \uc2e4\ud589\ud569\ub2c8\ub2e4.</div></div>';
    }
    break;
  case 'focusInput':input.focus();break;
  case 'injectPrompt':input.value=msg.value;input.style.height='auto';input.style.height=Math.min(input.scrollHeight,150)+'px';send();break;
} });
} catch(err) {
  document.body.innerHTML = '<div style="color:#ff4444;padding:20px;background:#111;height:100%;font-size:14px;overflow:auto;"><h2>\u26a0\ufe0f WEBVIEW JS CRASH</h2><pre>' + err.name + ': ' + err.message + '\\n' + err.stack + '</pre></div>';
}
</script></body></html>`;
fs.writeFileSync('test_eval3.html', html);
console.log(html.length);