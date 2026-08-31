import express from 'express';
import {
  addScenario,
  getUserScenarios,
  getSingleScenario,
  updateScenario,
  deleteScenario,
  getShopifyScenarioByUserId,
  getScenarioStatsForAdmin,
  getScenarioTriggerDefaults,
} from '../controller/Scenario.js';
import {
  getScenarioQueue,
  releaseScenarioQueue,
} from '../controller/scenarioQueue.js';

import { authMiddleware, adminMiddleware } from '../middleware/authmiddleware.js';

const scenarioRouter = express.Router();

// --- Authenticated User Endpoints ---
scenarioRouter.get('/trigger-defaults', authMiddleware, getScenarioTriggerDefaults);
scenarioRouter.post('/', authMiddleware, addScenario);
scenarioRouter.get('/user/:userId', authMiddleware, getUserScenarios);
scenarioRouter.get('/detail/:id', authMiddleware, getSingleScenario);
scenarioRouter.post('/details', authMiddleware, getShopifyScenarioByUserId);
scenarioRouter.put('/detail/:id', authMiddleware, updateScenario);
scenarioRouter.delete('/detail/:id', authMiddleware, deleteScenario);

/*
 * Leads that arrived while the scenario was switched Off. Read on resume
 * so the user can choose to answer the backlog or drop it — see
 * controller/scenarioQueue.js.
 */
scenarioRouter.get('/:id/queue', authMiddleware, getScenarioQueue);
scenarioRouter.post('/:id/queue', authMiddleware, releaseScenarioQueue);

// --- Admin-Only Endpoints ---
scenarioRouter.get('/scenario-stats', adminMiddleware, getScenarioStatsForAdmin);

export default scenarioRouter;
