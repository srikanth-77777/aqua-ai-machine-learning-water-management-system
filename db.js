const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'aquatwin.db'));

db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    pressure REAL,
    flow_rate REAL,
    water_quality REAL,
    energy REAL
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    severity TEXT NOT NULL,
    node_id TEXT,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS network_nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    status TEXT DEFAULT 'normal',
    pressure REAL DEFAULT 65,
    flow_rate REAL DEFAULT 120,
    quality REAL DEFAULT 98,
    last_updated INTEGER
  );

  CREATE TABLE IF NOT EXISTS network_edges (
    id TEXT PRIMARY KEY,
    from_node TEXT NOT NULL,
    to_node TEXT NOT NULL,
    capacity REAL DEFAULT 200,
    flow REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS scenarios (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    population_growth REAL,
    infrastructure_age REAL,
    climate_stress REAL,
    risk_score REAL,
    created_at INTEGER NOT NULL
  );
`);

// Seed initial network nodes if empty
const nodeCount = db.prepare('SELECT COUNT(*) as c FROM network_nodes').get();
if (nodeCount.c === 0) {
  const insertNode = db.prepare(`
    INSERT INTO network_nodes (id, name, type, x, y, status, pressure, flow_rate, quality, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEdge = db.prepare(`
    INSERT INTO network_edges (id, from_node, to_node, capacity, flow)
    VALUES (?, ?, ?, ?, ?)
  `);

  const nodes = [
    ['N001', 'Reservoir Alpha', 'reservoir', 15, 15, 'normal', 72, 180, 99, Date.now()],
    ['N002', 'Pump Station 1',  'pump',      35, 25, 'normal', 68, 160, 98, Date.now()],
    ['N003', 'Junction West',   'junction',  55, 15, 'normal', 64, 140, 97, Date.now()],
    ['N004', 'Treatment Plant', 'treatment', 55, 45, 'normal', 70, 200, 99, Date.now()],
    ['N005', 'Distribution Hub','junction',  75, 30, 'normal', 62, 130, 96, Date.now()],
    ['N006', 'Zone A Supply',   'valve',     90, 15, 'normal', 58, 110, 95, Date.now()],
    ['N007', 'Zone B Supply',   'valve',     90, 45, 'normal', 60, 120, 96, Date.now()],
    ['N008', 'Pump Station 2',  'pump',      30, 60, 'normal', 66, 150, 97, Date.now()],
    ['N009', 'Storage Tank',    'tank',      70, 65, 'normal', 55, 90,  95, Date.now()],
    ['N010', 'Pressure Monitor','monitor',   50, 75, 'normal', 50, 80,  94, Date.now()],
  ];

  const edges = [
    ['E001', 'N001', 'N002', 300, 180],
    ['E002', 'N002', 'N003', 250, 160],
    ['E003', 'N002', 'N004', 280, 200],
    ['E004', 'N003', 'N005', 200, 140],
    ['E005', 'N004', 'N005', 220, 190],
    ['E006', 'N005', 'N006', 180, 110],
    ['E007', 'N005', 'N007', 190, 120],
    ['E008', 'N001', 'N008', 260, 150],
    ['E009', 'N008', 'N009', 170, 90],
    ['E010', 'N009', 'N010', 150, 80],
    ['E011', 'N004', 'N009', 200, 100],
  ];

  const insertNodes = db.transaction(() => {
    for (const n of nodes) insertNode.run(...n);
    for (const e of edges) insertEdge.run(...e);
  });
  insertNodes();
  console.log('✅ Database seeded with initial network data');
}

module.exports = db;
