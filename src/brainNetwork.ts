import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { _getBrainDir } from './config';

export async function showBrainNetwork(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'brainTopology',
        'Neural Construct (Brain)',
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    const brainDir = _getBrainDir();
    const realClusters: Record<string, string[]> = {};
    let filesFound = 0;

    function walkDir(dir: string) {
        if (filesFound >= 600 || !fs.existsSync(dir)) return;
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walkDir(fullPath);
                } else if (entry.isFile() && fullPath.endsWith('.md')) {
                    const folderName = path.basename(dir);
                    const groupName = folderName === path.basename(_getBrainDir()) ? 'Brain Root' : folderName;
                    if (!realClusters[groupName]) realClusters[groupName] = [];
                    realClusters[groupName].push(entry.name.replace('.md', ''));
                    filesFound++;
                }
            }
        } catch {
            // Ignore unreadable brain folders.
        }
    }

    walkDir(brainDir);

    if (Object.keys(realClusters).length === 0) {
        realClusters['Empty Brain'] = ['Second Brain 저장소가 아직 비어있거나, 활성화되지 않았습니다.'];
    }

    const clustersJsonString = JSON.stringify(realClusters);

    panel.webview.html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>Connect AI - Neural Construct</title>
  <style>
    body { margin: 0; padding: 0; background: #0a0a0a; overflow: hidden; width: 100vw; height: 100vh; font-family: 'SF Pro Display', -apple-system, sans-serif; }
    #ui-layer { position: absolute; top: 20px; left: 24px; z-index: 10; pointer-events: none; }
    #ui-layer h1 { font-size: 22px; margin: 0 0 4px 0; font-weight: 800; letter-spacing: -0.5px; color: #e0e0e0; }
    #ui-layer h1 span { color: #00cc44; }
    #ui-layer p { margin: 0; font-size: 12px; color: #555; }
    #mem-status { color: #888; font-family: 'SF Mono', monospace; font-size: 11px; }
    canvas { cursor: grab; }
    canvas:active { cursor: grabbing; }
  </style>
  <script src="https://unpkg.com/force-graph"></script>
</head>
<body>
  <div id="ui-layer">
    <h1>\\u2726 <span id="titleSpan">Neural Construct</span></h1>
    <p id="mem-status">loading...</p>
  </div>
  <div id="graph"></div>
  <script>
    const clusters = ${clustersJsonString};
    let nid = 0;
    const gData = { nodes: [], links: [] };
    gData.nodes.push({ id: nid++, group: -1, name: 'Workspace Root', val: 22, connections: 0 });
    let gi = 0;
    Object.values(clusters).forEach(names => {
      names.forEach(name => { gData.nodes.push({ id: nid++, group: gi, name, val: 2, connections: 0 }); });
      gi++;
    });
    const byGroup = {};
    gData.nodes.forEach(n => { if(n.group>=0){ if(!byGroup[n.group]) byGroup[n.group]=[]; byGroup[n.group].push(n); }});
    Object.values(byGroup).forEach(g => {
      // Connect files in the same folder to each other (dense subgraph)
      for(let i=0;i<g.length;i++) {
        for(let j=i+1;j<g.length;j++) {
           // Much higher connection chance inside the same folder so they cluster well
           if(Math.random()<0.6){
             gData.links.push({source:g[i].id,target:g[j].id}); g[i].connections++; g[j].connections++;
           }
        }
      }
    });
    // Connect all folder nodes up to the root to unify the graph
    gData.nodes.forEach(n => { 
        if(n.group>=0){ 
            if (Math.random() < 0.15) { // 15% chance to link to root to maintain overall structure
               gData.links.push({source:n.id,target:0}); n.connections++; gData.nodes[0].connections++; 
            }
        }
    });
    for(let i=0;i< (gData.nodes.length * 1.5);i++){
      const a=1+Math.floor(Math.random()*(gData.nodes.length-1)), b=1+Math.floor(Math.random()*(gData.nodes.length-1));
      if(a!==b && gData.nodes[a].group!==gData.nodes[b].group){ gData.links.push({source:a,target:b}); gData.nodes[a].connections++; gData.nodes[b].connections++; }
    }
    gData.nodes.forEach(n => { n.val = Math.max(2, n.connections*1.5); });
    document.getElementById('mem-status').textContent = gData.nodes.length+' nodes \\u00b7 '+gData.links.length+' synapses';
    const gc = ['#00cc44','#00b7ff','#ff6b6b','#ffaa33','#aa66ff','#00cc44','#66cccc','#00ff88','#ff66aa'];
    const Graph = ForceGraph()(document.getElementById('graph'))
      .backgroundColor('#0a0a0a')
      .nodeCanvasObject((node, ctx, globalScale) => {
        const r = Math.sqrt(node.val)*1.8;
        ctx.beginPath(); ctx.arc(node.x, node.y, r, 0, 2*Math.PI);
        if(node.group===-1){ 
            // Glowing Brain Root
            ctx.shadowBlur = 15; ctx.shadowColor = '#00ff66';
            ctx.fillStyle='#0f0f0f'; ctx.fill(); 
            ctx.strokeStyle='#00ff66'; ctx.lineWidth=2; ctx.stroke(); 
            ctx.shadowBlur = 0;
        }
        else if(node.connections>2){ 
            ctx.shadowBlur = 8; ctx.shadowColor = gc[node.group]||'#00cc44';
            ctx.fillStyle=gc[node.group]||'#00cc44'; ctx.fill(); 
            ctx.shadowBlur = 0;
        }
        else { ctx.fillStyle='#2a2a2a'; ctx.fill(); }
        
        const showLabel = globalScale>1.2 || node.connections>3 || node.group===-1;
        if(showLabel){
          const fs=Math.max(2.5, Math.min(5, 11/globalScale));
          ctx.font=fs+'px -apple-system, sans-serif'; ctx.textAlign='center'; ctx.textBaseline='top';
          ctx.fillStyle=node.connections>2?'#e0e0e0':'#555';
          if(node.group===-1) ctx.fillStyle='#00ff66';
          ctx.fillText(node.name, node.x, node.y+r+2);
        }
      })
      .nodePointerAreaPaint((node,color,ctx) => {
        const r=Math.sqrt(node.val)*1.8+4; ctx.beginPath(); ctx.arc(node.x,node.y,r,0,2*Math.PI); ctx.fillStyle=color; ctx.fill();
      })
      .linkColor(() => 'rgba(0, 255, 102, 0.1)')
      .linkWidth(0.8)
      .linkDirectionalParticles(2)
      .linkDirectionalParticleWidth(1.5)
      .linkDirectionalParticleSpeed(0.005)
      .linkDirectionalParticleColor(() => '#00ff66')
      .d3VelocityDecay(0.08) // Lower friction so they drift and move organically!
      .warmupTicks(50)
      .cooldownTicks(500) // Keep them moving longer
      .graphData(gData);
    Graph.d3Force('charge').strength(-60); // Softer repulsion for gentle drift
    Graph.d3Force('link').distance(60);
    Graph.onNodeClick(node => { Graph.centerAt(node.x,node.y,800); Graph.zoom(4,1200); });
    setTimeout(() => {
        Graph.zoomToFit(1500, 40);
        document.getElementById('titleSpan').innerText = "Live Workspace Topology";
    }, 500);

    // Make sure graph expands dynamically on window resize
    window.addEventListener('resize', () => {
        Graph.width(window.innerWidth).height(window.innerHeight);
    });
  </script>
</body>
</html>`;
}
