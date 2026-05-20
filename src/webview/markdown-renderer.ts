import { esc, escapeRegExp, applyLiteralMarkdownFallback } from './strings';
import { codeBlock } from './highlight';
import { splitFileReference } from './file-refs';
import { isEditableFilePath, resolveEditableWorkspacePath } from '../editableFiles';

const texmath = require('markdown-it-texmath');
const katex = require('katex');

interface WebviewWindow extends Window {
  markdownit?: any;
}

const typedWindow = window as WebviewWindow;

export interface MarkdownRendererConfig {
  state: {
    workspaceFiles: Set<string>;
  };
  renderFileChangesSummary: (payloadText: string) => string;
  log?: (message: string, level?: string) => void;
}

export function createMarkdownRenderer(config: MarkdownRendererConfig) {
  const { state, renderFileChangesSummary, log } = config;

  let mdRenderer: any = null;

  function installMathRenderer(md: any): void {
    try {
      md.use(texmath, {
        engine: katex,
        delimiters: 'dollars',
        katexOptions: {
          throwOnError: false,
          strict: 'ignore'
        }
      });
    } catch (error) {
      if (log) log('[markdown] Failed to enable math rendering: ' + String(error), 'warn');
    }
  }

  function getMarkdownRenderer(): any {
    if (!typedWindow.markdownit) {
      return null;
    }
    if (mdRenderer) {
      return mdRenderer;
    }

    const md = typedWindow.markdownit({
      html: false,
      linkify: true,
      typographer: true,
      breaks: true
    });
    installMathRenderer(md);
    md.validateLink = function(url: string) {
      const rawValue = String(url || '').trim();
      const value = rawValue.toLowerCase();
      const reference = splitFileReference(rawValue);
      if (reference.path && isEditableWorkspaceFile(reference.path)) {
        return true;
      }
      return value.startsWith('https://') ||
             value.startsWith('http://') ||
             value.startsWith('mailto:') ||
             value.startsWith('#');
    };

    md.renderer.rules.fence = (tokens: any[], idx: number) => codeBlock(tokens[idx].content, tokens[idx].info);
    md.renderer.rules.code_block = (tokens: any[], idx: number) => codeBlock(tokens[idx].content, '');

    const defaultLinkOpen = md.renderer.rules.link_open || function(tokens: any[], idx: number, options: any, env: any, self: any) {
      return self.renderToken(tokens, idx, options);
    };
    md.renderer.rules.link_open = function(tokens: any[], idx: number, options: any, env: any, self: any) {
      const token = tokens[idx];
      const hrefIndex = token.attrIndex('href');
      const href = hrefIndex >= 0 ? token.attrs[hrefIndex][1] : '';
      const reference = splitFileReference(href);
      if (reference.path && isEditableWorkspaceFile(reference.path)) {
        if (hrefIndex >= 0) token.attrs[hrefIndex][1] = '#';
        token.attrJoin('class', 'is-file-link');
        token.attrSet('data-action', 'open-file');
        token.attrSet('data-file-path', reference.path);
        if (typeof reference.line === 'number') {
          token.attrSet('data-line', String(reference.line));
        }
        token.attrSet('role', 'button');
        token.attrSet('tabindex', '0');
        token.attrSet('title', 'Open ' + reference.path);
        return defaultLinkOpen(tokens, idx, options, env, self);
      }

      const target = token.attrIndex('target');
      if (target < 0) token.attrPush(['target', '_blank']); else token.attrs[target][1] = '_blank';
      const rel = token.attrIndex('rel');
      if (rel < 0) token.attrPush(['rel', 'noopener noreferrer']); else token.attrs[rel][1] = 'noopener noreferrer';
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    function isEditableWorkspaceFile(name: string): boolean {
      const text = String(name || '').trim();
      if (!text || text.includes(' ') || text.includes('\n')) return false;

      // 1. Check absolute path (rough check for Windows/POSIX)
      if (text.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(text)) {
        return isEditableFilePath(text);
      }

      // 2. Check relative or basename match in workspace
      return Boolean(resolveEditableWorkspacePath(text, state.workspaceFiles));
    }

    const defaultCodeInline = md.renderer.rules.code_inline || function(tokens: any[], idx: number, options: any, env: any, self: any) {
      return self.renderToken(tokens, idx, options);
    };
    md.renderer.rules.code_inline = function(tokens: any[], idx: number, options: any, env: any, self: any) {
      const token = tokens[idx];
      if (isEditableWorkspaceFile(token.content)) {
        token.attrJoin('class', 'is-file');
      }
      return defaultCodeInline(tokens, idx, options, env, self);
    };

    mdRenderer = md;
    return mdRenderer;
  }

  function fmt(text: string): string {
    let value = text || '';
    if (value.lastIndexOf('<create_file') > value.lastIndexOf('</create_file>')) value += '</create_file>';
    if (value.lastIndexOf('<edit_file') > value.lastIndexOf('</edit_file>')) value += '</edit_file>';
    if (value.lastIndexOf('<run_command') > value.lastIndexOf('</run_command>')) value += '</run_command>';
    if (value.lastIndexOf('<delete_file') > value.lastIndexOf('</delete_file>')) value += '</delete_file>';
    if (value.lastIndexOf('<read_file') > value.lastIndexOf('</read_file>')) value += '</read_file>';
    if (value.lastIndexOf('<list_files') > value.lastIndexOf('</list_files>')) value += '</list_files>';
    if ((value.match(/```/g) || []).length % 2 !== 0) value += '\n' + String.fromCharCode(96, 96, 96);

    const blocks: { token: string; html: string }[] = [];
    function pushBlock(html: string) {
      const token = '@@LLEM_BLOCK_' + blocks.length + '@@';
      blocks.push({ token, html });
      return token;
    }

    value = value.replace(/(?:<|call:)\s*create_file\s+path="([^"]+)">([\s\S]*?)<\/create_file>/gi, function(_: string, filePath: string, content: string) {
      const attrs = isEditableFilePath(filePath)
        ? ' data-action="open-file" data-file-path="' + esc(filePath) + '" role="button" tabindex="0" title="Open ' + esc(filePath) + '"'
        : '';
      return pushBlock('<div class="file-badge"' + attrs + '>📁 Created file · ' + esc(filePath) + '</div><div class="code-wrap"><pre><code>' + esc(content) + '</code></pre><button class="copy-btn" data-action="copy-code">Copy</button></div>');
    });
    value = value.replace(/(?:<|call:)\s*edit_file\s+path="([^"]+)">([\s\S]*?)<\/edit_file>/gi, function(_: string, filePath: string, content: string) {
      const attrs = isEditableFilePath(filePath)
        ? ' data-action="open-file" data-file-path="' + esc(filePath) + '" role="button" tabindex="0" title="Open ' + esc(filePath) + '"'
        : '';
      return pushBlock('<div class="edit-badge"' + attrs + '>✏️ Edited file · ' + esc(filePath) + '</div><div class="code-wrap"><pre><code>' + esc(content) + '</code></pre><button class="copy-btn" data-action="copy-code">Copy</button></div>');
    });
    value = value.replace(/(?:<|call:)\s*run_command>([\s\S]*?)<\/run_command>/gi, function(_: string, command: string) {
      return pushBlock('<div class="cmd-badge"><span>▶ ' + esc(command.trim()) + '</span><button class="btn-open" data-action="open-terminal">Open</button></div>');
    });
    value = value.replace(/(?:<|call:)\s*delete_file\s+path="([^"]+)"\s*\/?>/gi, function(_: string, filePath: string) {
      const attrs = isEditableFilePath(filePath)
        ? ' data-action="open-file" data-file-path="' + esc(filePath) + '" role="button" tabindex="0" title="Open ' + esc(filePath) + '"'
        : '';
      return pushBlock('<div class="delete-badge"' + attrs + '>🗑️ Deleted file · ' + esc(filePath) + '</div>');
    });
    value = value.replace(/(?:<|call:)\s*read_file\s+path="([^"]+)"\s*\/?>/gi, function(_: string, filePath: string) {
      const attrs = isEditableFilePath(filePath)
        ? ' data-action="open-file" data-file-path="' + esc(filePath) + '" role="button" tabindex="0" title="Open ' + esc(filePath) + '"'
        : '';
      return pushBlock('<div class="read-badge"' + attrs + '>📖 Read file · ' + esc(filePath) + '</div>');
    });
    value = value.replace(/(?:<|call:)\s*list_files\s+path="([^"]+)"\s*\/?>/gi, function(_: string, filePath: string) {
      return pushBlock('<div class="list-badge">📁 Listed directory · ' + esc(filePath) + '</div>');
    });
    value = value.replace(/^@@LLEM_FILE_CHANGES\s+(.+)$/gm, function(_: string, payloadText: string) {
      return pushBlock(renderFileChangesSummary(payloadText));
    });

    const md = getMarkdownRenderer();
    if (!md) {
      let fallback = esc(value).replace(/\n/g, '<br>');
      blocks.forEach(function(block) {
        fallback = fallback.split(block.token).join(block.html);
      });
      return fallback;
    }

    let html = md.render(value);
    blocks.forEach(function(block) {
      // Replace token. If markdown-it wrapped it in <p> because it was on its own line, we try to unwrap it
      // to keep the layout clean, but split/join handles inline cases perfectly.
      const wrapped = new RegExp('<p>\\s*' + escapeRegExp(block.token) + '\\s*<\\/p>', 'g');
      html = html.replace(wrapped, block.html).split(block.token).join(block.html);
    });
    return applyLiteralMarkdownFallback(html);
  }

  return {
    fmt
  };
}
