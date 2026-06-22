const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all nodes and edges (full network topology)
router.get('/topology', (req, res) => {
  const nodes = db.prepare('SELECT * FROM network_nodes').all();
  const edges = db.prepare('SELECT * FROM network_edges').all();
  res.json({ nodes, edges });
});

// GET single node
router.get('/nodes/:id', (req, res) => {
  const node = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });
  res.json(node);
});

// POST simulate failure on a node
router.post('/nodes/:id/failure', (req, res) => {
  const node = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  const update = db.prepare(`
    UPDATE network_nodes SET status = 'failure', pressure = pressure * 0.4, 
    flow_rate = flow_rate * 0.3, last_updated = ? WHERE id = ?
  `);
  update.run(Date.now(), req.params.id);

  // Cascade to connected nodes
  const connectedEdges = db.prepare(`
    SELECT * FROM network_edges WHERE from_node = ? OR to_node = ?
  `).all(req.params.id, req.params.id);

  const cascadeUpdate = db.prepare(`
    UPDATE network_nodes SET status = 'warning', pressure = pressure * 0.75,
    flow_rate = flow_rate * 0.7, last_updated = ? WHERE id = ?
  `);
  for (const edge of connectedEdges) {
    const neighborId = edge.from_node === req.params.id ? edge.to_node : edge.from_node;
    cascadeUpdate.run(Date.now(), neighborId);
  }

  res.json({ success: true, message: `Failure simulated on ${node.name}` });
});

// POST recover a node
router.post('/nodes/:id/recover', (req, res) => {
  const node = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(req.params.id);
  if (!node) return res.status(404).json({ error: 'Node not found' });

  db.prepare(`
    UPDATE network_nodes SET status = 'normal', 
    pressure = ?, flow_rate = ?, quality = ?, last_updated = ?
    WHERE id = ?
  `).run(
    65 + Math.random() * 15,
    120 + Math.random() * 80,
    94 + Math.random() * 5,
    Date.now(),
    req.params.id
  );

  // Recover neighbors too
  const connectedEdges = db.prepare(`
    SELECT * FROM network_edges WHERE from_node = ? OR to_node = ?
  `).all(req.params.id, req.params.id);

  for (const edge of connectedEdges) {
    const neighborId = edge.from_node === req.params.id ? edge.to_node : edge.from_node;
    const neighbor = db.prepare('SELECT * FROM network_nodes WHERE id = ?').get(neighborId);
    if (neighbor && neighbor.status === 'warning') {
      db.prepare(`UPDATE network_nodes SET status = 'normal', last_updated = ? WHERE id = ?`)
        .run(Date.now(), neighborId);
    }
  }

  res.json({ success: true, message: `Node ${node.name} recovered` });
});

module.exports = router;
