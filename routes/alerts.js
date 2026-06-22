const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// GET all alerts (optionally filter by status)
router.get('/', (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM alerts ORDER BY created_at DESC';
  let args = [];
  if (status) {
    query = 'SELECT * FROM alerts WHERE status = ? ORDER BY created_at DESC';
    args = [status];
  }
  const alerts = db.prepare(query).all(...args);
  res.json(alerts);
});

// POST create new alert
router.post('/', (req, res) => {
  const { type, severity, node_id, message } = req.body;
  if (!type || !severity || !message) {
    return res.status(400).json({ error: 'type, severity, message required' });
  }
  const id = uuidv4();
  db.prepare(`
    INSERT INTO alerts (id, type, severity, node_id, message, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)
  `).run(id, type, severity, node_id || null, message, Date.now());
  res.json({ id, success: true });
});

// PATCH resolve an alert
router.patch('/:id/resolve', (req, res) => {
  const result = db.prepare(`
    UPDATE alerts SET status = 'resolved', resolved_at = ? WHERE id = ?
  `).run(Date.now(), req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Alert not found' });
  res.json({ success: true });
});

// DELETE clear all resolved alerts
router.delete('/resolved', (req, res) => {
  const result = db.prepare("DELETE FROM alerts WHERE status = 'resolved'").run();
  res.json({ deleted: result.changes });
});

// Leak detection: GET leak probabilities per node
router.get('/leaks', (req, res) => {
  const nodes = db.prepare('SELECT id, name, pressure, flow_rate, quality, status FROM network_nodes').all();
  const leaks = nodes.map(n => {
    // Compute probability based on pressure variance and quality
    const pressureFactor = Math.max(0, (75 - n.pressure) / 75);
    const qualityFactor = Math.max(0, (100 - n.quality) / 100);
    const statusBoost = n.status === 'failure' ? 0.5 : n.status === 'warning' ? 0.2 : 0;
    const probability = Math.min(1, (pressureFactor * 0.5 + qualityFactor * 0.3 + statusBoost + Math.random() * 0.05));
    return {
      node_id: n.id,
      node_name: n.name,
      probability: Math.round(probability * 100) / 100,
      risk_level: probability > 0.6 ? 'high' : probability > 0.35 ? 'medium' : 'low'
    };
  });
  res.json(leaks);
});

module.exports = router;
