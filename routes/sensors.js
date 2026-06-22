const express = require('express');
const router = express.Router();
const db = require('../db');

// GET latest sensor reading for all nodes
router.get('/latest', (req, res) => {
  const readings = db.prepare(`
    SELECT sr.*, nn.name as node_name FROM sensor_readings sr
    JOIN network_nodes nn ON sr.node_id = nn.id
    WHERE sr.id IN (
      SELECT MAX(id) FROM sensor_readings GROUP BY node_id
    )
    ORDER BY sr.timestamp DESC
  `).all();
  res.json(readings);
});

// GET historical readings for a specific node
router.get('/history/:nodeId', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const readings = db.prepare(`
    SELECT * FROM sensor_readings
    WHERE node_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(req.params.nodeId, limit);
  res.json(readings.reverse());
});

// GET aggregated stats across all nodes
router.get('/stats', (req, res) => {
  const nodes = db.prepare('SELECT * FROM network_nodes').all();
  if (nodes.length === 0) return res.json({});

  const avgPressure = nodes.reduce((s, n) => s + n.pressure, 0) / nodes.length;
  const avgFlow = nodes.reduce((s, n) => s + n.flow_rate, 0) / nodes.length;
  const avgQuality = nodes.reduce((s, n) => s + n.quality, 0) / nodes.length;
  const failCount = nodes.filter(n => n.status === 'failure').length;
  const warnCount = nodes.filter(n => n.status === 'warning').length;

  res.json({
    avg_pressure: Math.round(avgPressure * 10) / 10,
    avg_flow: Math.round(avgFlow * 10) / 10,
    avg_quality: Math.round(avgQuality * 10) / 10,
    total_nodes: nodes.length,
    failure_count: failCount,
    warning_count: warnCount,
    health_score: Math.round(((nodes.length - failCount) / nodes.length) * 100)
  });
});

// POST store a new reading batch
router.post('/record', (req, res) => {
  const { readings } = req.body;
  if (!readings || !Array.isArray(readings)) {
    return res.status(400).json({ error: 'readings array required' });
  }
  const insert = db.prepare(`
    INSERT INTO sensor_readings (node_id, timestamp, pressure, flow_rate, water_quality, energy)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      insert.run(r.node_id, r.timestamp || Date.now(), r.pressure, r.flow_rate, r.water_quality, r.energy);
    }
  });
  insertMany(readings);
  res.json({ success: true, count: readings.length });
});

module.exports = router;
