import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getVaultDir } from './config';

export async function showBrainNetwork(_context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'vaultTopology',
        'LLeM Vault Map',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    const vaultDir = getVaultDir();
    const clusters: Record<string, string[]> = {};
    let filesFound = 0;

    function walkDir(dir: string) {
        if (filesFound >= 600 || !fs.existsSync(dir)) {
            return;
        }

        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                    continue;
                }

                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walkDir(fullPath);
                    continue;
                }

                if (!entry.isFile() || !fullPath.endsWith('.md')) {
                    continue;
                }

                const folderName = path.basename(dir);
                const groupName = folderName === path.basename(vaultDir) ? 'Vault Root' : folderName;
                clusters[groupName] ??= [];
                clusters[groupName].push(entry.name.replace(/\.md$/i, ''));
                filesFound += 1;
            }
        } catch {
            // Ignore unreadable vault folders.
        }
    }

    walkDir(vaultDir);

    if (Object.keys(clusters).length === 0) {
        clusters['Empty Vault'] = ['No markdown notes yet. Drop files in and the map will wake up.'];
    }

    const clustersJsonString = JSON.stringify(clusters);
    const nonce = crypto.randomBytes(16).toString('base64');

    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src data:; connect-src 'none';">
  <title>LLeM - Vault Map</title>
  <style nonce="${nonce}">
    body { margin: 0; padding: 0; background: #0c0b11; overflow: hidden; width: 100vw; height: 100vh; font-family: 'SF Pro Display', -apple-system, sans-serif; }
    #ui-layer { position: absolute; top: 20px; left: 24px; z-index: 10; pointer-events: none; }
    #ui-layer h1 { font-size: 22px; margin: 0 0 4px 0; font-weight: 800; color: #f6f1e8; }
    #ui-layer h1 span { color: #ff9e58; }
    #ui-layer p { margin: 0; font-size: 12px; color: #8f8a9a; }
    #graph { width: 100vw; height: 100vh; }
    canvas { display: block; width: 100%; height: 100%; cursor: grab; }
    canvas:active { cursor: grabbing; }
  </style>
</head>
<body>
  <div id="ui-layer">
    <h1>LL <span id="titleSpan">Vault Map</span></h1>
    <p id="mem-status">loading...</p>
  </div>
  <div id="graph"><canvas id="vaultCanvas"></canvas></div>
  <script nonce="${nonce}">
    const clusters = ${clustersJsonString};
    const colors = ['#ff9e58','#68e1fd','#ff6b8a','#ffd166','#8f7cff','#7de2d1','#f7b267','#9ae6b4','#f6bd60'];
    const canvas = document.getElementById('vaultCanvas');
    const ctx = canvas.getContext('2d');
    const status = document.getElementById('mem-status');
    const titleSpan = document.getElementById('titleSpan');
    const nodes = [];
    const links = [];
    let rootNode;
    let dragging = null;
    let pointer = { x: 0, y: 0 };
    let scale = 1;
    let panX = 0;
    let panY = 0;

    function addNode(name, group, radius) {
      const angle = nodes.length * 2.399963;
      const distance = 40 + Math.sqrt(nodes.length + 1) * 28;
      const node = {
        id: nodes.length,
        name,
        group,
        radius,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        vx: 0,
        vy: 0,
        fixed: false
      };
      nodes.push(node);
      return node;
    }

    rootNode = addNode('Vault Root', -1, 18);
    Object.entries(clusters).forEach(([groupName, names], groupIndex) => {
      const groupAnchor = addNode(groupName, groupIndex, 11);
      links.push({ source: rootNode, target: groupAnchor, strength: 0.018, distance: 120 });
      names.forEach((name, noteIndex) => {
        const note = addNode(name, groupIndex, 5 + Math.min(7, name.length / 18));
        links.push({ source: groupAnchor, target: note, strength: 0.025, distance: 58 + (noteIndex % 5) * 8 });
        if (noteIndex > 0 && noteIndex % 3 === 0) {
          links.push({ source: nodes[note.id - 1], target: note, strength: 0.006, distance: 90 });
        }
      });
    });

    function resize() {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function screenToWorld(x, y) {
      return {
        x: (x - window.innerWidth / 2 - panX) / scale,
        y: (y - window.innerHeight / 2 - panY) / scale
      };
    }

    function pickNode(x, y) {
      const world = screenToWorld(x, y);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const hitRadius = Math.max(12, n.radius + 6);
        if (Math.hypot(n.x - world.x, n.y - world.y) <= hitRadius) {
          return n;
        }
      }
      return null;
    }

    function simulate() {
      for (const n of nodes) {
        if (n === rootNode) continue;
        const dx = n.x - rootNode.x;
        const dy = n.y - rootNode.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const force = 260 / (dist * dist);
        n.vx += (dx / dist) * force;
        n.vy += (dy / dist) * force;
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.max(1, Math.hypot(dx, dy));
          const min = a.radius + b.radius + 24;
          if (dist < min) {
            const push = (min - dist) * 0.006;
            const fx = (dx / dist) * push;
            const fy = (dy / dist) * push;
            a.vx -= fx; a.vy -= fy;
            b.vx += fx; b.vy += fy;
          }
        }
      }

      for (const link of links) {
        const a = link.source, b = link.target;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const pull = (dist - link.distance) * link.strength;
        const fx = (dx / dist) * pull;
        const fy = (dy / dist) * pull;
        if (!a.fixed) { a.vx += fx; a.vy += fy; }
        if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
      }

      rootNode.vx += (0 - rootNode.x) * 0.008;
      rootNode.vy += (0 - rootNode.y) * 0.008;

      for (const n of nodes) {
        if (n.fixed) continue;
        n.vx *= 0.86;
        n.vy *= 0.86;
        n.x += n.vx;
        n.y += n.vy;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.save();
      ctx.translate(window.innerWidth / 2 + panX, window.innerHeight / 2 + panY);
      ctx.scale(scale, scale);

      ctx.lineWidth = 1 / scale;
      links.forEach(link => {
        const color = link.target.group === -1 ? '#ff9e58' : colors[Math.max(0, link.target.group) % colors.length];
        ctx.strokeStyle = color + '33';
        ctx.beginPath();
        ctx.moveTo(link.source.x, link.source.y);
        ctx.lineTo(link.target.x, link.target.y);
        ctx.stroke();
      });

      nodes.forEach(node => {
        const color = node.group === -1 ? '#ff9e58' : colors[Math.max(0, node.group) % colors.length];
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.group === -1 ? '#16131f' : color;
        ctx.shadowBlur = node.group === -1 ? 18 : 7;
        ctx.shadowColor = color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = node.group === -1 ? '#ff9e58' : '#0c0b11';
        ctx.lineWidth = node.group === -1 ? 2 / scale : 1 / scale;
        ctx.stroke();

        if (scale > 0.72 || node.radius > 10 || node.group === -1) {
          ctx.font = Math.max(7, 11 / scale) + 'px -apple-system, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = node.group === -1 ? '#ff9e58' : '#f6f1e8';
          ctx.fillText(node.name, node.x, node.y + node.radius + 4 / scale);
        }
      });

      ctx.restore();
    }

    function frame() {
      simulate();
      draw();
      requestAnimationFrame(frame);
    }

    canvas.addEventListener('pointerdown', event => {
      const node = pickNode(event.clientX, event.clientY);
      if (!node) return;
      dragging = node;
      pointer = screenToWorld(event.clientX, event.clientY);
      dragging.fixed = true;
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', event => {
      if (!dragging) return;
      pointer = screenToWorld(event.clientX, event.clientY);
      dragging.x = pointer.x;
      dragging.y = pointer.y;
      dragging.vx = 0;
      dragging.vy = 0;
    });

    canvas.addEventListener('pointerup', event => {
      if (dragging) {
        dragging.fixed = false;
        dragging = null;
      }
      canvas.releasePointerCapture(event.pointerId);
    });

    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? 0.9 : 1.1;
      scale = Math.min(3, Math.max(0.45, scale * delta));
    }, { passive: false });

    window.addEventListener('resize', resize);
    resize();
    status.textContent = nodes.length + ' nodes · ' + links.length + ' links';
    setTimeout(() => { titleSpan.textContent = 'Live vault topology'; }, 500);
    frame();
  </script>
</body>
</html>`;
}
