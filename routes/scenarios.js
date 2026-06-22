const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// GET all scenarios
router.get('/', (req, res) => {
  const scenarios = db.prepare('SELECT * FROM scenarios ORDER BY created_at DESC LIMIT 20').all();
  res.json(scenarios);
});

// POST run a new scenario simulation
router.post('/run', (req, res) => {
  const { population_growth, infrastructure_age, climate_stress, name } = req.body;
  if (population_growth === undefined || infrastructure_age === undefined || climate_stress === undefined) {
    return res.status(400).json({ error: 'population_growth, infrastructure_age, climate_stress required' });
  }

  // Risk score algorithm (weighted composite)
  const pg = parseFloat(population_growth);  // 0-100
  const ia = parseFloat(infrastructure_age); // 0-100
  const cs = parseFloat(climate_stress);     // 0-100

  // Weighted formula
  const raw = (pg * 0.3) + (ia * 0.45) + (cs * 0.25);
  const risk_score = Math.round(Math.min(100, Math.max(0, raw)));

  // Projected metrics
  const demand_increase = Math.round((1 + pg / 100) * 100) / 100;
  const failure_risk = Math.round((ia / 100) * 85 + (cs / 100) * 15);
  const energy_cost_increase = Math.round((pg * 0.4 + cs * 0.3) * 10) / 10;

  const id = uuidv4();
  db.prepare(`
    INSERT INTO scenarios (id, name, population_growth, infrastructure_age, climate_stress, risk_score, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name || `Scenario ${new Date().toISOString()}`, pg, ia, cs, risk_score, Date.now());

  res.json({
    id,
    risk_score,
    demand_increase,
    failure_risk,
    energy_cost_increase,
    recommendation: risk_score > 70
      ? 'CRITICAL: Immediate infrastructure upgrade and emergency planning required.'
      : risk_score > 45
      ? 'WARNING: Plan phased upgrades and increase monitoring frequency.'
      : 'STABLE: Continue regular maintenance schedule with quarterly reviews.',
    ai_insights: generateInsights(pg, ia, cs, risk_score)
  });
});

function generateInsights(pg, ia, cs, rs) {
  const insights = [];
  if (ia > 60) insights.push('Infrastructure age is a primary risk driver — prioritize pipe replacement in zones with >40yr old mains.');
  if (pg > 50) insights.push('High population growth will strain distribution capacity — recommend expanding Pump Station 2 by 30%.');
  if (cs > 55) insights.push('Climate stress increases drought probability — install automated demand-response valves.');
  if (rs < 30) insights.push('System is in good health. Predictive maintenance schedule is sufficient.');
  if (insights.length === 0) insights.push('Moderate risk across all vectors. Maintain current monitoring protocols.');
  return insights;
}

module.exports = router;
