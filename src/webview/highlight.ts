import { esc } from './strings';
import { langLabel } from './format';

export function highlight(code: string): string {
  let html = esc(code);
  const tokens: string[] = [];

  // 1. Protect comments
  html = html.replace(/(\/\/[^\n]*|#.*)/g, (m) => {
    const id = '@@LLEM_TOK_' + tokens.length + '@@';
    tokens.push('<span class="tok-comment">' + m + '</span>');
    return id;
  });

  // 2. Protect strings
  html = html.replace(/(&quot;[^&]*?&quot;|&#x27;[^&]*?&#x27;)/g, (m) => {
    const id = '@@LLEM_TOK_' + tokens.length + '@@';
    tokens.push('<span class="tok-string">' + m + '</span>');
    return id;
  });

  // 3. Highlight keywords & numbers on the clean text
  html = html.replace(/\b(function|const|let|var|return|if|else|for|while|class|import|export|from|default|async|await|try|catch|throw|new|this|def|self|print|lambda|yield|with|as|raise|except|finally)\b/g, '<span class="tok-keyword">$1</span>');
  html = html.replace(/\b(\d+\.?\d*)\b/g, '<span class="tok-number">$1</span>');

  // Step 4: Restore tokens
  for (let i = 0; i < tokens.length; i++) {
    // Use function to avoid $1 backreference bug if tokens[i] contains $
    html = html.replace('@@LLEM_TOK_' + i + '@@', function() { return tokens[i]; });
  }
  return html;
}

export function codeBlock(code: string, info: string): string {
  const lang = langLabel(info);
  return '<div class="code-wrap"><span class="code-lang">' + esc(lang) + '</span><pre><code>' + highlight(code) + '</code></pre><button class="copy-btn" data-action="copy-code">Copy</button></div>';
}
