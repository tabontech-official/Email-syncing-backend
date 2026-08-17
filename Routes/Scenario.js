import express from 'express';
import {
  addScenario,
  getUserScenarios,
  getSingleScenario,
  updateScenario,
  deleteScenario,
  getShopifyScenarioByUserId,
  getScenarioStatsForAdmin,
} from '../controller/Scenario.js';

import { authMiddleware, adminMiddleware } from '../middleware/authmiddleware.js';

const scenarioRouter = express.Router();

// --- Authenticated User Endpoints ---
scenarioRouter.post('/', authMiddleware, addScenario);
scenarioRouter.get('/user/:userId', authMiddleware, getUserScenarios);
scenarioRouter.get('/detail/:id', authMiddleware, getSingleScenario);
scenarioRouter.post('/details', authMiddleware, getShopifyScenarioByUserId);
scenarioRouter.put('/detail/:id', authMiddleware, updateScenario);
scenarioRouter.delete('/detail/:id', authMiddleware, deleteScenario);

// --- Admin-Only Endpoints ---
scenarioRouter.get('/scenario-stats', adminMiddleware, getScenarioStatsForAdmin);

export default scenarioRouter;
