// ═══════════════════════════════════════════════════════
//  AquaTwin AI — Full Stack Client Application
// ═══════════════════════════════════════════════════════

const API = '';  // same-origin
let ws = null;
let latestNodes = [];
let latestStats = {};
let selectedNode = null;
let charts = {};
let chartData = { pressure:[], flow:[], quality:[], energy:[], labels:[] };
const MAX_CHART_POINTS = 30;
let aiLogCount = 0;
let leakData = [];
let leakGrid = [];  // 10x10
let isScanning = false;

// ─── Init ────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initCursor();
  initBgCanvas();
  initCharts();
  initLeakGrid();
  connectWebSocket();
  fetchAlerts();
  fetchLeakData();
  fetchScenarioHistory();
  generateRecommendations();
  setInterval(fetchAlerts, 10000);
  setInterval(updateLeakGrid, 3000);
});

// ─── Tab Switching ────────────────────────────────────
function switchTab(name, btn) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  btn.classList.add('active');
  if (name === 'leak') fetchLeakData();
  if (name === 'scenario') fetchScenarioHistory();
  if (name === 'alerts') fetchAlerts();
}

// ─── WebSocket ────────────────────────────────────────
function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    setWsBadge(true);
    showToast('🔌 Live data stream connected', 'success');
  };

  ws.onclose = () => {
    setWsBadge(false);
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = () => setWsBadge(false);

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleWsMessage(msg);
    } catch(err) { console.error(err); }
  };
}

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'snapshot':
    case 'sensor_update':
      latestNodes = msg.nodes || latestNodes;
      latestStats = msg.stats || latestStats;
      updateHeaderStats(latestStats);
      updateNetworkTab(latestNodes, latestStats);
      updateAnalyticsTab(latestStats, msg.sensorReadings);
      if (msg.aiLog) appendAiLog(msg.aiLog);
      if (msg.activeAlerts) updateAlertBadge(msg.activeAlerts.length);
      break;
  }
}

function setWsBadge(connected) {
  const el = document.getElementById('ws-badge');
  el.textContent = connected ? '⬤ Live' : '⬤ Reconnecting...';
  el.className = 'ws-badge ' + (connected ? 'connected' : 'disconnected');
}

// ─── Header Stats ─────────────────────────────────────
function updateHeaderStats(stats) {
  if (!stats || !stats.avg_pressure) return;
  document.getElementById('stat-pressure').textContent = stats.avg_pressure.toFixed(1);
  document.getElementById('stat-flow').textContent    = stats.avg_flow.toFixed(1);
  document.getElementById('health-score').textContent = stats.health_score;

  const hDot = document.getElementById('health-dot');
  hDot.className = 'dot' + (stats.health_score >= 80 ? '' : stats.health_score >= 50 ? ' warn' : ' danger');

  const sysDot  = document.getElementById('sys-dot');
  const sysText = document.getElementById('sys-status-text');
  if (stats.failure_count > 0) {
    sysDot.className = 'dot danger';
    sysText.textContent = `${stats.failure_count} Node Failure${stats.failure_count>1?'s':''}`;
  } else if (stats.warning_count > 0) {
    sysDot.className = 'dot warn';
    sysText.textContent = `${stats.warning_count} Warning${stats.warning_count>1?'s':''}`;
  } else {
    sysDot.className = 'dot';
    sysText.textContent = 'System Online';
  }
}

// ═══════════════════════════════════════════════════════
//  TAB 1: NETWORK MAP
// ═══════════════════════════════════════════════════════
const NET_NODE_TYPES = {
  reservoir: { icon: '🏞', color: '#00c4b4' },
  pump:      { icon: '⚙', color: '#7c4dff' },
  junction:  { icon: '🔵', color: '#00e5ff' },
  treatment: { icon: '🧪', color: '#00e676' },
  valve:     { icon: '🔧', color: '#ff9100' },
  tank:      { icon: '🛢', color: '#4a6fa5' },
  monitor:   { icon: '📡', color: '#ff3d71' },
};
const NET_EDGES = [
  ['N001','N002'], ['N002','N003'], ['N002','N004'], ['N003','N005'],
  ['N004','N005'], ['N005','N006'], ['N005','N007'], ['N001','N008'],
  ['N008','N009'], ['N009','N010'], ['N004','N009']
];

let netCanvas, netCtx, netNodes = [], netEdges = NET_EDGES;
let hoveredNode = null;
let animFrame = null;

function updateNetworkTab(nodes, stats) {
  netNodes = nodes;
  document.getElementById('net-pressure').textContent = stats.avg_pressure?.toFixed(1) || '—';
  document.getElementById('net-flow').textContent     = stats.avg_flow?.toFixed(1) || '—';
  document.getElementById('net-quality').textContent  = stats.avg_quality?.toFixed(1) || '—';
  const hs = stats.health_score || 0;
  const hsEl = document.getElementById('net-health');
  hsEl.textContent = hs;
  hsEl.className = 'stat-value ' + (hs >= 80 ? 'good' : hs >= 50 ? 'warn' : 'danger');
  renderNodeList(nodes);
  if (!animFrame) drawNetworkLoop();
}

function initNetworkCanvas() {
  netCanvas = document.getElementById('network-canvas');
  netCtx = netCanvas.getContext('2d');
  netCanvas.width  = netCanvas.offsetWidth;
  netCanvas.height = 420;
  netCanvas.addEventListener('mousemove', onNetMouseMove);
  netCanvas.addEventListener('mouseleave', () => { hoveredNode = null; hideTooltip(); });
  netCanvas.addEventListener('click', onNetClick);
}

function getNodeCanvasPos(node) {
  const w = netCanvas.width, h = netCanvas.height;
  return { x: (node.x / 100) * (w - 60) + 30, y: (node.y / 100) * (h - 60) + 30 };
}

function drawNetworkLoop() {
  if (!netCanvas) { initNetworkCanvas(); }
  drawNetwork();
  animFrame = requestAnimationFrame(drawNetworkLoop);
}

let pulseT = 0;
function drawNetwork() {
  if (!netCtx || !netNodes.length) return;
  pulseT += 0.04;
  const w = netCanvas.width, h = netCanvas.height;
  netCtx.clearRect(0, 0, w, h);

  // Draw edges
  for (const [fromId, toId] of netEdges) {
    const from = netNodes.find(n => n.id === fromId);
    const to   = netNodes.find(n => n.id === toId);
    if (!from || !to) continue;
    const fp = getNodeCanvasPos(from);
    const tp = getNodeCanvasPos(to);

    const edgeFailed = from.status === 'failure' || to.status === 'failure';
    const edgeWarn   = from.status === 'warning' || to.status === 'warning';
    netCtx.beginPath();
    netCtx.moveTo(fp.x, fp.y);
    netCtx.lineTo(tp.x, tp.y);
    netCtx.strokeStyle = edgeFailed ? 'rgba(255,61,113,0.5)' : edgeWarn ? 'rgba(255,145,0,0.5)' : 'rgba(0,196,180,0.25)';
    netCtx.lineWidth = 2;
    netCtx.stroke();

    // Animated flow dot
    if (!edgeFailed) {
      const t2 = (pulseT * 0.4 + (fromId.charCodeAt(1) * 0.13)) % 1;
      const fx = fp.x + (tp.x - fp.x) * t2;
      const fy = fp.y + (tp.y - fp.y) * t2;
      netCtx.beginPath();
      netCtx.arc(fx, fy, 3, 0, Math.PI * 2);
      netCtx.fillStyle = edgeWarn ? '#ff9100' : 'rgba(0,229,255,0.9)';
      netCtx.fill();
    }
  }

  // Draw nodes
  for (const node of netNodes) {
    const pos = getNodeCanvasPos(node);
    const type = NET_NODE_TYPES[node.type] || { icon:'●', color:'#4a6fa5' };
    const isHovered = hoveredNode && hoveredNode.id === node.id;
    const r = isHovered ? 22 : 18;
    const pulse = 1 + Math.sin(pulseT * 2 + node.id.charCodeAt(1)) * 0.08;

    // Status ring
    const ringColor = node.status === 'failure' ? '#ff3d71' : node.status === 'warning' ? '#ff9100' : type.color;
    netCtx.beginPath();
    netCtx.arc(pos.x, pos.y, (r + 5) * pulse, 0, Math.PI * 2);
    netCtx.strokeStyle = ringColor + '50';
    netCtx.lineWidth = 2;
    netCtx.stroke();

    // Fill
    const grad = netCtx.createRadialGradient(pos.x-3, pos.y-3, 2, pos.x, pos.y, r);
    grad.addColorStop(0, node.status === 'failure' ? '#5a1020' : '#0d1f3c');
    grad.addColorStop(1, node.status === 'failure' ? '#2a0810' : '#070f20');
    netCtx.beginPath();
    netCtx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    netCtx.fillStyle = grad;
    netCtx.fill();
    netCtx.strokeStyle = ringColor;
    netCtx.lineWidth = 2;
    netCtx.stroke();

    // Icon
    netCtx.font = `${isHovered?14:12}px serif`;
    netCtx.textAlign = 'center';
    netCtx.textBaseline = 'middle';
    netCtx.fillText(type.icon, pos.x, pos.y);

    // Name label
    netCtx.font = '9px "DM Sans", sans-serif';
    netCtx.fillStyle = isHovered ? '#00e5ff' : '#7a92c4';
    netCtx.fillText(node.name.split(' ').slice(-1)[0], pos.x, pos.y + r + 10);
  }
}

function onNetMouseMove(e) {
  const rect = netCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  let found = null;
  for (const node of netNodes) {
    const pos = getNodeCanvasPos(node);
    const dist = Math.hypot(pos.x - mx, pos.y - my);
    if (dist < 22) { found = node; break; }
  }
  hoveredNode = found;
  if (found) showTooltip(e.clientX, e.clientY, found);
  else hideTooltip();
}

function onNetClick(e) {
  const rect = netCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  for (const node of netNodes) {
    const pos = getNodeCanvasPos(node);
    if (Math.hypot(pos.x - mx, pos.y - my) < 22) {
      selectedNode = node;
      showToast(`📍 Selected: ${node.name} (${node.status})`, 'info');
      return;
    }
  }
}

function showTooltip(x, y, node) {
  const t = document.getElementById('node-tooltip');
  document.getElementById('tt-name').textContent = node.name;
  document.getElementById('tt-pressure').textContent = node.pressure.toFixed(1) + ' PSI';
  document.getElementById('tt-flow').textContent    = node.flow_rate.toFixed(1) + ' L/m';
  document.getElementById('tt-quality').textContent = node.quality.toFixed(1);
  document.getElementById('tt-status').textContent  = node.status.toUpperCase();
  t.style.display = 'block';
  t.style.left = (x + 18) + 'px';
  t.style.top  = (y - 10) + 'px';
}
function hideTooltip() { document.getElementById('node-tooltip').style.display = 'none'; }

function renderNodeList(nodes) {
  const el = document.getElementById('node-list');
  el.innerHTML = nodes.map(n => `
    <div class="node-mini" onclick="focusNode('${n.id}')">
      <div class="nm-name">${NET_NODE_TYPES[n.type]?.icon||'●'} ${n.name}</div>
      <span class="nm-status ${n.status}">${n.status}</span>
      <div class="nm-vals">${n.pressure.toFixed(0)} PSI · ${n.flow_rate.toFixed(0)} L/m</div>
    </div>
  `).join('');
}

function focusNode(id) {
  selectedNode = netNodes.find(n => n.id === id);
  if (selectedNode) showToast(`📍 ${selectedNode.name} · ${selectedNode.status}`, 'info');
}

async function simulateFailure() {
  const node = selectedNode || netNodes[Math.floor(Math.random() * netNodes.length)];
  if (!node) return;
  const res = await apiFetch(`/api/network/nodes/${node.id}/failure`, 'POST');
  if (res?.success) showToast(`⚠ Failure simulated on ${node.name}`, 'warn');
}

async function recoverAll() {
  for (const node of netNodes) {
    if (node.status !== 'normal') {
      await apiFetch(`/api/network/nodes/${node.id}/recover`, 'POST');
    }
  }
  showToast('✅ All nodes recovered', 'success');
}

function refreshNetwork() {
  apiFetch('/api/network/topology').then(data => {
    if (data?.nodes) { latestNodes = data.nodes; updateNetworkTab(data.nodes, latestStats); }
  });
}

// ═══════════════════════════════════════════════════════
//  TAB 2: ANALYTICS CHARTS
// ═══════════════════════════════════════════════════════
function initCharts() {
  const defaults = { responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color:'#4a6fa5', font:{size:9} }, grid: { color:'rgba(74,111,165,0.1)' } },
      y: { ticks: { color:'#4a6fa5', font:{size:9} }, grid: { color:'rgba(74,111,165,0.1)' } }
    }
  };
  function makeDataset(color) {
    return { data:[], borderColor: color, backgroundColor: color+'22', fill:true,
      tension: 0.4, pointRadius: 2, pointBackgroundColor: color };
  }
  charts.pressure = new Chart(document.getElementById('chart-pressure'), { type:'line', data:{ labels:[], datasets:[makeDataset('#00e5ff')] }, options: JSON.parse(JSON.stringify(defaults)) });
  charts.flow     = new Chart(document.getElementById('chart-flow'),     { type:'line', data:{ labels:[], datasets:[makeDataset('#00e676')] }, options: JSON.parse(JSON.stringify(defaults)) });
  charts.quality  = new Chart(document.getElementById('chart-quality'),  { type:'line', data:{ labels:[], datasets:[makeDataset('#7c4dff')] }, options: JSON.parse(JSON.stringify(defaults)) });
  charts.energy   = new Chart(document.getElementById('chart-energy'),   { type:'line', data:{ labels:[], datasets:[makeDataset('#ff9100')] }, options: JSON.parse(JSON.stringify(defaults)) });
}

function updateAnalyticsTab(stats, readings) {
  if (!stats?.avg_pressure) return;
  const ts = new Date().toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit',second:'2-digit'});

  const energy = parseFloat((stats.avg_flow * 0.12 + stats.avg_pressure * 0.08).toFixed(1));

  document.getElementById('an-pressure').textContent = stats.avg_pressure.toFixed(1);
  document.getElementById('an-flow').textContent     = stats.avg_flow.toFixed(1);
  document.getElementById('an-quality').textContent  = stats.avg_quality.toFixed(1);
  document.getElementById('an-energy').textContent   = energy;

  function pushChart(chart, val) {
    chart.data.labels.push(ts);
    chart.data.datasets[0].data.push(val);
    if (chart.data.labels.length > MAX_CHART_POINTS) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }
    chart.update('none');
  }
  pushChart(charts.pressure, stats.avg_pressure);
  pushChart(charts.flow, stats.avg_flow);
  pushChart(charts.quality, stats.avg_quality);
  pushChart(charts.energy, energy);
}

// ═══════════════════════════════════════════════════════
//  TAB 3: AI ENGINE
// ═══════════════════════════════════════════════════════
function appendAiLog(msg) {
  const box = document.getElementById('ai-log-box');
  const ts  = new Date().toLocaleTimeString('en-GB');
  const div = document.createElement('div');
  div.className = 'ai-log-entry';
  div.innerHTML = `<span class="ts">[${ts}]</span><span class="msg"> ${msg}</span>`;
  box.appendChild(div);
  if (box.children.length > 80) box.removeChild(box.firstChild);
  box.scrollTop = box.scrollHeight;
  aiLogCount++;
}

function clearAiLog() {
  document.getElementById('ai-log-box').innerHTML = '';
  showToast('🗑 AI log cleared', 'info');
}

function triggerAiAnalysis() {
  const msgs = [
    'Initiating full network topology scan...',
    'Running gradient boosted anomaly detection model...',
    'Comparing current sensor readings with baseline profiles...',
    'Hydraulic simulation converging — 47 iterations complete.',
    'Pressure wave analysis complete. No hammer events detected.',
    'Calibrating probabilistic leak detection thresholds...',
    'LSTM time-series forecast: next 6h stable with 91.4% confidence.',
  ];
  msgs.forEach((m, i) => setTimeout(() => appendAiLog(m), i * 400));
  showToast('🧠 Deep analysis initiated', 'success');
}

const RECOS = [
  { type:'maintenance', severity:'warn', icon:'🔧', msg:'Replace aging pipe section between N003 and N005. Estimated age 32 years. Failure probability 67% within 18 months.' },
  { type:'energy',      severity:'info', icon:'⚡', msg:'Shift Pump Station 1 to off-peak operation (02:00–05:00) to reduce energy costs by ~22%.' },
  { type:'quality',     severity:'high', icon:'🧪', msg:'Chlorine residual at Zone B Supply approaching minimum threshold. Recommend dosage increase by 15mg/L.' },
  { type:'leak',        severity:'warn', icon:'💧', msg:'Non-revenue water ratio elevated to 18.4% in western sector. Deploy acoustic logger for further investigation.' },
  { type:'capacity',    severity:'info', icon:'📈', msg:'Distribution Hub approaching 84% capacity during peak hours. Consider load-balancing valve adjustment.' },
];

function generateRecommendations() {
  const list = document.getElementById('reco-list');
  const chosen = [...RECOS].sort(() => 0.5 - Math.random()).slice(0, 3);
  list.innerHTML = chosen.map((r, i) => `
    <div class="reco-card" id="reco-${i}">
      <div class="reco-type" style="color:${r.severity==='high'?'var(--danger)':r.severity==='warn'?'var(--warn)':'var(--teal)'}">${r.icon} ${r.type.toUpperCase()}</div>
      <div class="reco-msg">${r.msg}</div>
      <div class="reco-actions">
        <button class="btn btn-primary btn-sm" onclick="acceptReco(${i})">✓ Accept</button>
        <button class="btn btn-ghost btn-sm" onclick="dismissReco(${i})">✕ Dismiss</button>
      </div>
    </div>
  `).join('');
}

function acceptReco(i) {
  const card = document.getElementById('reco-' + i);
  if (card) { card.classList.add('accepted'); card.querySelector('.reco-actions').innerHTML = '<span style="color:var(--success);font-size:0.75rem">✓ Action queued for execution</span>'; }
  showToast('✅ Recommendation accepted', 'success');
}
function dismissReco(i) {
  const card = document.getElementById('reco-' + i);
  if (card) card.style.display = 'none';
  showToast('Recommendation dismissed', 'info');
}

const QUICK_SCENARIOS = {
  drought:     ['Activating drought response protocol...', 'Reducing non-essential flow allocations by 30%...', 'Alerting Zone A and B supply nodes to conserve mode.', 'Emergency storage tanks activated.'],
  peak:        ['Peak demand detected — activating demand management...', 'Pump Station 2 ramping to 120% capacity...', 'Pressure-reducing valves engaged in Zone B.', 'Standby reservoir tapped for buffer supply.'],
  maintenance: ['Switching network to maintenance mode...', 'Isolating Section E003 for pipe inspection...', 'Diverting flow through alternate route N001→N008→N009.', 'Maintenance team notified via SCADA alert.'],
  optimize:    ['Running energy optimization algorithm...', 'Optimal pump schedule computed for next 24h.', 'Estimated savings: 18.7 kWh per day.', 'Scheduling auto-throttle on Pump Station 1 at 02:15.'],
};

function quickScenario(type) {
  const msgs = QUICK_SCENARIOS[type];
  if (!msgs) return;
  msgs.forEach((m, i) => setTimeout(() => appendAiLog(m), i * 500));
  switchTab('ai', document.getElementById('tab-ai'));
  showToast(`🚀 ${type} scenario activated`, 'warn');
}

// ═══════════════════════════════════════════════════════
//  TAB 4: LEAK DETECTION
// ═══════════════════════════════════════════════════════
function initLeakGrid() {
  leakGrid = Array.from({ length: 100 }, () => Math.random() * 0.4);
  renderLeakGrid();
}

function renderLeakGrid() {
  const grid = document.getElementById('leak-grid');
  grid.innerHTML = '';
  leakGrid.forEach((prob, i) => {
    const cell = document.createElement('div');
    cell.className = 'leak-cell';
    cell.id = `lc-${i}`;
    const r = Math.round(prob * 255);
    const g = Math.round((1 - prob) * 160);
    cell.style.background = `rgb(${r},${g},40)`;
    cell.style.opacity = 0.4 + prob * 0.6;
    cell.title = `Zone ${i+1}: ${(prob*100).toFixed(0)}% probability`;
    cell.textContent = prob > 0.6 ? '!' : '';
    cell.style.color = '#fff';
    grid.appendChild(cell);
  });
  const hasHigh = leakGrid.some(p => p > 0.6);
  document.getElementById('leak-badge').style.display = hasHigh ? 'inline' : 'none';
}

function updateLeakGrid() {
  leakGrid = leakGrid.map(p => Math.max(0, Math.min(1, p + (Math.random() - 0.495) * 0.05)));
  renderLeakGrid();
}

function scanAll() {
  if (isScanning) return;
  isScanning = true;
  showToast('🔬 Full grid scan initiated...', 'info');
  let i = 0;
  const interval = setInterval(() => {
    const cells = document.querySelectorAll('.leak-cell');
    cells.forEach(c => c.classList.remove('scanning'));
    if (cells[i]) cells[i].classList.add('scanning');
    i++;
    if (i >= cells.length) {
      clearInterval(interval);
      isScanning = false;
      cells.forEach(c => c.classList.remove('scanning'));
      leakGrid = leakGrid.map(p => p + (Math.random() - 0.4) * 0.15);
      renderLeakGrid();
      showToast('✅ Scan complete — grid updated', 'success');
    }
  }, 30);
}

function deployRepair() {
  const highIdx = leakGrid.reduce((acc, p, i) => p > 0.6 ? [...acc, i] : acc, []);
  if (!highIdx.length) { showToast('No high-risk zones detected', 'info'); return; }
  highIdx.forEach(i => { leakGrid[i] = Math.max(0, leakGrid[i] - 0.4); });
  renderLeakGrid();
  showToast(`🔧 Repair crews deployed to ${highIdx.length} high-risk zone(s)`, 'success');
}

async function fetchLeakData() {
  const data = await apiFetch('/api/alerts/leaks');
  if (!data) return;
  leakData = data;
  const list = document.getElementById('leak-node-list');
  list.innerHTML = data.sort((a,b) => b.probability - a.probability).map(n => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 10px;border-bottom:1px solid rgba(0,196,180,0.08);font-size:0.75rem">
      <div>
        <div style="font-weight:600;margin-bottom:2px">${n.node_name}</div>
        <div style="font-family:'Space Mono',monospace;color:var(--text-dim);font-size:0.65rem">${n.node_id}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:'Space Mono',monospace;font-weight:700;color:${n.risk_level==='high'?'var(--danger)':n.risk_level==='medium'?'var(--warn)':'var(--success)'}">${(n.probability*100).toFixed(0)}%</div>
        <div style="font-size:0.62rem;color:var(--text-dim)">${n.risk_level} risk</div>
      </div>
    </div>
  `).join('');
}

// ═══════════════════════════════════════════════════════
//  TAB 5: SCENARIO SIMULATOR
// ═══════════════════════════════════════════════════════
async function runScenario() {
  const pg = parseFloat(document.getElementById('sl-pop').value);
  const ia = parseFloat(document.getElementById('sl-age').value);
  const cs = parseFloat(document.getElementById('sl-climate').value);

  showToast('⏳ Running simulation...', 'info');
  const res = await apiFetch('/api/scenarios/run', 'POST', { population_growth: pg, infrastructure_age: ia, climate_stress: cs });
  if (!res) return;

  // Gauge
  const score = res.risk_score;
  const gaugeArc = document.getElementById('gauge-arc');
  const total = 251;
  gaugeArc.style.strokeDasharray = `${(score / 100) * total} ${total}`;
  document.getElementById('gauge-score').textContent = score;
  const gaugeLabel = document.getElementById('gauge-label');
  gaugeLabel.textContent = score >= 70 ? '🔴 CRITICAL RISK' : score >= 45 ? '🟠 MODERATE RISK' : '🟢 LOW RISK';
  document.getElementById('gauge-score').style.color = score >= 70 ? 'var(--danger)' : score >= 45 ? 'var(--warn)' : 'var(--success)';

  // Metrics
  const metrics = document.getElementById('scenario-metrics');
  metrics.innerHTML = `
    <div class="stat-tile"><div class="stat-label">Risk Score</div><div class="stat-value ${score>=70?'danger':score>=45?'warn':'good'}">${score}</div><div class="stat-unit">/ 100</div></div>
    <div class="stat-tile"><div class="stat-label">Demand Increase</div><div class="stat-value">${res.demand_increase}x</div><div class="stat-unit">multiplier</div></div>
    <div class="stat-tile"><div class="stat-label">Failure Risk</div><div class="stat-value warn">${res.failure_risk}%</div><div class="stat-unit">probability</div></div>
    <div class="stat-tile"><div class="stat-label">Energy Cost Rise</div><div class="stat-value">${res.energy_cost_increase}%</div><div class="stat-unit">projected</div></div>
  `;

  // Insights
  const insights = document.getElementById('scenario-insights');
  insights.innerHTML = `
    <div style="margin-bottom:10px;padding:12px;background:rgba(${score>=70?'255,61,113':score>=45?'255,145,0':'0,230,118'},0.08);border-radius:8px;font-size:0.8rem;border-left:3px solid ${score>=70?'var(--danger)':score>=45?'var(--warn)':'var(--success)'}">
      ${res.recommendation}
    </div>
    ${(res.ai_insights||[]).map(ins => `<div class="insight-item">💡 ${ins}</div>`).join('')}
  `;

  document.getElementById('scenario-results').style.display = 'block';
  fetchScenarioHistory();
  showToast(`✅ Simulation complete — Risk: ${score}/100`, score>=70?'danger':score>=45?'warn':'success');
}

async function fetchScenarioHistory() {
  const data = await apiFetch('/api/scenarios');
  if (!data) return;
  const el = document.getElementById('scenario-history');
  if (!data.length) { el.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;padding:10px">No scenarios run yet.</div>'; return; }
  el.innerHTML = data.map(s => `
    <div style="display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(0,196,180,0.08);font-size:0.75rem">
      <div>
        <div style="font-weight:600">${new Date(s.created_at).toLocaleString()}</div>
        <div style="color:var(--text-dim);font-size:0.65rem;font-family:'Space Mono',monospace">Pop: ${s.population_growth}% · Age: ${s.infrastructure_age}% · Climate: ${s.climate_stress}%</div>
      </div>
      <div style="font-family:'Space Mono',monospace;font-weight:700;color:${s.risk_score>=70?'var(--danger)':s.risk_score>=45?'var(--warn)':'var(--success)'}">${s.risk_score}</div>
    </div>
  `).join('');
}

function exportReport() {
  const pg = document.getElementById('sl-pop').value;
  const ia = document.getElementById('sl-age').value;
  const cs = document.getElementById('sl-climate').value;
  const score = document.getElementById('gauge-score').textContent;
  const ts = new Date().toLocaleString();
  const txt = `AQUATWIN AI — SCENARIO REPORT\n${'='.repeat(40)}\nGenerated: ${ts}\n\nPARAMETERS\n  Population Growth  : ${pg}%\n  Infrastructure Age : ${ia}%\n  Climate Stress     : ${cs}%\n\nRESULTS\n  Risk Score: ${score}/100\n  System: ${JSON.stringify(latestStats, null, 2)}\n\nPowered by AquaTwin AI v1.0\n`;
  const blob = new Blob([txt], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `aquatwin_report_${Date.now()}.txt`;
  a.click();
  showToast('📄 Report exported', 'success');
}

// ═══════════════════════════════════════════════════════
//  TAB 6: ALERTS
// ═══════════════════════════════════════════════════════
async function fetchAlerts() {
  const data = await apiFetch('/api/alerts?status=active');
  if (!data) return;
  updateAlertBadge(data.length);
  const list = document.getElementById('alerts-list');
  if (!data.length) {
    list.innerHTML = '<div style="text-align:center;color:var(--success);padding:40px;font-size:0.85rem">✅ No active alerts — all systems nominal</div>';
    return;
  }
  list.innerHTML = data.map(a => `
    <div class="alert-item ${a.severity}">
      <div class="alert-icon">${a.type==='pressure'?'💧':a.type==='quality'?'🧪':'⚠'}</div>
      <div class="alert-body">
        <div class="alert-msg">${a.message}</div>
        <div class="alert-meta">${a.type.toUpperCase()} · ${a.node_id||'System'} · ${new Date(a.created_at).toLocaleString()}</div>
      </div>
      <button class="btn btn-ghost btn-sm alert-resolve" onclick="resolveAlert('${a.id}')">✓ Resolve</button>
    </div>
  `).join('');
}

async function resolveAlert(id) {
  await apiFetch(`/api/alerts/${id}/resolve`, 'PATCH');
  showToast('✅ Alert resolved', 'success');
  fetchAlerts();
}

async function clearResolved() {
  const res = await apiFetch('/api/alerts/resolved', 'DELETE');
  showToast(`🗑 Cleared ${res?.deleted||0} resolved alerts`, 'info');
  fetchAlerts();
}

function updateAlertBadge(count) {
  document.getElementById('alert-count-badge').textContent = count;
}

// ═══════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════
async function apiFetch(url, method = 'GET', body = null) {
  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + url, opts);
    if (!res.ok) throw new Error(res.statusText);
    return res.json();
  } catch(e) { console.error('API error:', e); return null; }
}

function showToast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  const container = document.getElementById('toast-container');
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; el.style.transition = '0.3s'; setTimeout(() => el.remove(), 300); }, 3500);
}

// ─── Animated Background Canvas ─────────────────────
function initBgCanvas() {
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');
  let w, h, particles = [];
  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < 60; i++) particles.push({ x: Math.random()*1400, y: Math.random()*900, r: 1+Math.random()*2, vx: (Math.random()-0.5)*0.3, vy: (Math.random()-0.5)*0.3, a: Math.random() });

  let t = 0;
  function draw() {
    ctx.clearRect(0, 0, w, h);
    t += 0.008;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 4) {
        const y = h * 0.5 + Math.sin(x * 0.006 + t + k * 1.2) * (40 + k * 20) + Math.sin(x * 0.012 - t * 0.7) * 15;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(0,196,180,${0.04 - k * 0.01})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    for (const p of particles) {
      p.x += p.vx; p.y += p.vy; p.a += 0.01;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(0,229,255,${0.08 + Math.abs(Math.sin(p.a)) * 0.12})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ─── Custom Cursor ───────────────────────────────────
function initCursor() {
  const ring = document.getElementById('cursor-ring');
  const dot  = document.getElementById('cursor-dot');
  let mx = 0, my = 0, rx = 0, ry = 0;
  window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; dot.style.left = mx+'px'; dot.style.top = my+'px'; });
  function animCursor() {
    rx += (mx - rx) * 0.15; ry += (my - ry) * 0.15;
    ring.style.left = rx+'px'; ring.style.top = ry+'px';
    requestAnimationFrame(animCursor);
  }
  animCursor();
}
