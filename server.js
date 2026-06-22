const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/network', require('./routes/network'));
app.use('/api/sensors', require('./routes/sensors'));
app.use('/api/alerts', require('./routes/alerts'));
app.use('/api/scenarios', require('./routes/scenarios'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), version: '1.0.0' });
});

// ─── WebSocket Real-time Engine ──────────────────────────────────────────────
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`🔌 Client connected. Total: ${clients.size}`);

  // Send initial snapshot
  sendSnapshot(ws);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleClientMessage(ws, msg);
    } catch (e) {
      console.error('WS message error:', e.message);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`🔌 Client disconnected. Total: ${clients.size}`);
  });

  ws.on('error', (err) => console.error('WS error:', err.message));
});

function sendSnapshot(ws) {
  const nodes = db.prepare('SELECT * FROM network_nodes').all();
  const stats = computeStats(nodes);
  const activeAlerts = db.prepare("SELECT * FROM alerts WHERE status='active' ORDER BY created_at DESC LIMIT 5").all();

  safeSend(ws, { type: 'snapshot', nodes, stats, activeAlerts });
}

function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case 'ping':
      safeSend(ws, { type: 'pong', ts: Date.now() });
      break;
    case 'subscribe':
      // Client can request specific node subscriptions in future
      break;
    default:
      break;
  }
}

function broadcast(data) {
  const str = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(str);
  }
}

function safeSend(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function computeStats(nodes) {
  if (!nodes.length) return {};
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  return {
    avg_pressure: Math.round(avg(nodes.map(n => n.pressure)) * 10) / 10,
    avg_flow: Math.round(avg(nodes.map(n => n.flow_rate)) * 10) / 10,
    avg_quality: Math.round(avg(nodes.map(n => n.quality)) * 10) / 10,
    failure_count: nodes.filter(n => n.status === 'failure').length,
    warning_count: nodes.filter(n => n.status === 'warning').length,
    total_nodes: nodes.length,
    health_score: Math.round(((nodes.length - nodes.filter(n => n.status === 'failure').length) / nodes.length) * 100)
  };
}

// ─── Sensor Simulation Loop ──────────────────────────────────────────────────
// Simulates real-time sensor data updates every 2 seconds
const AI_MESSAGES = [
  'Analyzing pressure variance in Zone B...',
  'Cross-referencing historical flow patterns with current demand...',
  'Running LSTM anomaly detection on pipe segment E004...',
  'Gradient descent optimization for pump scheduling complete.',
  'Water quality index WQI recalculated from 8 sensor inputs.',
  'Predictive model forecasts 94.2% reliability for next 24h.',
  'Evaluating optimal valve configuration for load balancing...',
  'Reinforcement learning agent updated pump station policy.',
  'Digital twin state synchronized with SCADA layer.',
  'Hydraulic simulation converged in 12 iterations.',
  'Energy efficiency increased 3.2% via AI pump scheduling.',
  'Detected micro-leak signature in sector G7 — confidence 87%.',
  'Calibrating flow meters: deviation < 0.5% — within tolerance.',
  'Real-time GIS overlay updated with sensor positions.',
  'Bayesian network updated with latest fault injection data.',
];

let aiMsgIndex = 0;

function simulateTick() {
  const nodes = db.prepare('SELECT * FROM network_nodes').all();
  const updateNode = db.prepare(`
    UPDATE network_nodes SET pressure=?, flow_rate=?, quality=?, last_updated=? WHERE id=?
  `);
  const insertReading = db.prepare(`
    INSERT INTO sensor_readings (node_id, timestamp, pressure, flow_rate, water_quality, energy)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();
  const updatedNodes = [];
  const sensorReadings = [];

  for (const node of nodes) {
    if (node.status === 'failure') continue; // Don't update failed nodes

    // Drift simulation
    const drift = () => (Math.random() - 0.48) * 2;
    const newPressure = Math.max(20, Math.min(100, node.pressure + drift()));
    const newFlow = Math.max(30, Math.min(250, node.flow_rate + drift() * 3));
    const newQuality = Math.max(80, Math.min(100, node.quality + (Math.random() - 0.5) * 0.3));
    const energy = Math.round((newFlow * 0.12 + newPressure * 0.08) * 10) / 10;

    updateNode.run(newPressure, newFlow, newQuality, now, node.id);
    updatedNodes.push({ ...node, pressure: newPressure, flow_rate: newFlow, quality: newQuality });
    sensorReadings.push({ node_id: node.id, timestamp: now, pressure: newPressure, flow_rate: newFlow, water_quality: newQuality, energy });

    // Auto-generate pressure alerts
    if (newPressure < 35) {
      const { v4: uuidv4 } = require('uuid');
      db.prepare(`
        INSERT INTO alerts (id, type, severity, node_id, message, status, created_at)
        VALUES (?, 'pressure', 'high', ?, ?, 'active', ?)
      `).run(uuidv4(), node.id, `Low pressure alert at ${node.name}: ${newPressure.toFixed(1)} PSI`, now);
    }
  }

  // Batch insert readings
  const insertMany = db.transaction((rows) => {
    for (const r of rows) insertReading.run(r.node_id, r.timestamp, r.pressure, r.flow_rate, r.water_quality, r.energy);
  });
  insertMany(sensorReadings);

  // Prune old readings (keep last 1000 per node)
  db.prepare(`
    DELETE FROM sensor_readings WHERE id NOT IN (
      SELECT id FROM sensor_readings ORDER BY timestamp DESC LIMIT 10000
    )
  `).run();

  // Broadcast update to all connected clients
  const stats = computeStats(db.prepare('SELECT * FROM network_nodes').all());
  const aiLog = AI_MESSAGES[aiMsgIndex % AI_MESSAGES.length];
  aiMsgIndex++;

  broadcast({
    type: 'sensor_update',
    timestamp: now,
    nodes: db.prepare('SELECT * FROM network_nodes').all(),
    stats,
    aiLog,
    sensorReadings
  });
}

// Cleanup old readings periodically (every 5 min)
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h
  db.prepare('DELETE FROM sensor_readings WHERE timestamp < ?').run(cutoff);
}, 5 * 60 * 1000);

// Tick interval
setInterval(simulateTick, 2000);

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌊 AquaTwin AI Server running at http://localhost:${PORT}`);
  console.log(`📡 WebSocket live stream active`);
  console.log(`📊 API: http://localhost:${PORT}/api/health\n`);
});
