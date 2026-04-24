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
                if (!clusters[groupName]) {
                    clusters[groupName] = [];
                }
                clusters[groupName].push(entry.name.replace('.md', ''));
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

    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>LLeM - Vault Map</title>
  <style>
    body { margin: 0; padding: 0; background: #0c0b11; overflow: hidden; width: 100vw; height: 100vh; font-family: 'SF Pro Display', -apple-system, sans-serif; }
    #ui-layer { position: absolute; top: 20px; left: 24px; z-index: 10; pointer-events: none; }
    #ui-layer h1 { font-size: 22px; margin: 0 0 4px 0; font-weight: 800; letter-spacing: -0.5px; color: #f6f1e8; }
    #ui-layer h1 span { color: #ff9e58; }
    #ui-layer p { margin: 0; font-size: 12px; color: #8f8a9a; }
    #mem-status { color: #b9b0c7; font-family: 'SF Mono', monospace; font-size: 11px; }
    canvas { cursor: grab; }
    canvas:active { cursor: grabbing; }
  </style>
  <script src="https://unpkg.com/force-graph"></script>
</head>
<body>
  <div id="ui-layer">
    <h1>LL <span id="titleSpan">Vault Map</span></h1>
    <p id="mem-status">loading...</p>
  </div>
  <div id="graph"></div>
  <script>
    const clusters = ${clustersJsonString};
    let nid = 0;
    const gData = { nodes: [], links: [] };
    gData.nodes.push({ id: nid++, group: -1, name: 'Vault Root', val: 22, connections: 0 });
    let gi = 0;
    Object.values(clusters).forEach(names => {
      names.forEach(name => { gData.nodes.push({ id: nid++, group: gi, name, val: 2, connections: 0 }); });
      gi++;
    });
    const byGroup = {};
    gData.nodes.forEach(n => { if(n.group>=0){ if(!byGroup[n.group]) byGroup[n.group]=[]; byGroup[n.group].push(n); }});
    Object.values(byGroup).forEach(g => {
      for(let i=0;i<g.length;i++) {
        for(let j=i+1;j<g.length;j++) {
           if(Math.random()<0.6){
             gData.links.push({source:g[i].id,target:g[j].id}); g[i].connections++; g[j].connections++;
           }
        }
      }
    });
    gData.nodes.forEach(n => {
        if(n.group>=0){
            if (Math.random() < 0.15) {
               gData.links.push({source:n.id,target:0}); n.connections++; gData.nodes[0].connections++;
            }
        }
    });
    for(let i=0;i<(gData.nodes.length * 1.5);i++){
      const a=1+Math.floor(Math.random()*(gData.nodes.length-1)), b=1+Math.floor(Math.random()*(gData.nodes.length-1));
      if(a!==b && gData.nodes[a].group!==gData.nodes[b].group){ gData.links.push({source:a,target:b}); gData.nodes[a].connections++; gData.nodes[b].connections++; }
    }
    gData.nodes.forEach(n => { n.val = Math.max(2, n.connections*1.5); });
    document.getElementById('mem-status').textContent = gData.nodes.length+' nodes · '+gData.links.length+' links';
    const gc = ['#ff9e58','#68e1fd','#ff6b8a','#ffd166','#8f7cff','#7de2d1','#f7b267','#9ae6b4','#f6bd60'];
    const Graph = ForceGraph()(document.getElementById('graph'))
      .backgroundColor('#0c0b11')
      .nodeCanvasObject((node, ctx, globalScale) => {
        const r = Math.sqrt(node.val)*1.8;
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2*Math.PI);
        if(node.group===-1){
            ctx.shadowBlur = 15; ctx.shadowColor = '#ff9e58';
            ctx.fillStyle='#16131f'; ctx.fill();
            ctx.strokeStyle='#ff9e58'; ctx.lineWidth=2; ctx.stroke();
            ctx.shadowBlur = 0;
        }
        else if(node.connections>2){
            ctx.shadowBlur = 8; ctx.shadowColor = gc[node.group]||'#ff9e58';
            ctx.fillStyle=gc[node.group]||'#ff9e58'; ctx.fill();
            ctx.shadowBlur = 0;
        }
        else { ctx.fillStyle='#2b2636'; ctx.fill(); }

        const showLabel = globalScale>1.2 || node.connections>3 || node.group===-1;
        if(showLabel){
          const fs=Math.max(2.5, Math.min(5, 11/globalScale));
          ctx.font=fs+'px -apple-system, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
          ctx.fillStyle=node.connections>2?'#f6f1e8':'#8f8a9a';
          if(node.group===-1) ctx.fillStyle='#ff9e58';
          ctx.fillText(node.name, node.x, node.y+r+2);
        }
      })
      .nodePointerAreaPaint((node,color,ctx) => {
        const r=Math.sqrt(node.val)*1.8+4; ctx.beginPath(); ctx.arc(node.x,node.y,r,0,2*Math.PI); ctx.fillStyle=color; ctx.fill();
      })
      .linkColor(() => 'rgba(255, 158, 88, 0.10)')
      .linkWidth(0.8)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleWidth(1.5)
      .linkDirectionalParticleSpeed(0.005)
      .linkDirectionalParticleColor(() => '#68e1fd')
      .d3VelocityDecay(0.08)
      .warmupTicks(50)
      .cooldownTicks(500)
      .graphData(gData);
    Graph.d3Force('charge').strength(-60);
    Graph.d3Force('link').distance(60);
    Graph.onNodeClick(node => { Graph.centerAt(node.x,node.y,800); Graph.zoom(4,1200); });
    setTimeout(() => {
        Graph.zoomToFit(1500, 40);
        document.getElementById('titleSpan').innerText = "Live vault topology";
    }, 500);
    window.addEventListener('resize', () => {
        Graph.width(window.innerWidth).height(window.innerHeight);
    });
  </script>
</body>
</html>`;
}
