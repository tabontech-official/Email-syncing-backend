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

const scenarioRouter = express.Router();

scenarioRouter.post('/', addScenario);

scenarioRouter.get('/user/:userId', getUserScenarios);

scenarioRouter.get('/detail/:id', getSingleScenario);
scenarioRouter.post('/details', getShopifyScenarioByUserId);
scenarioRouter.get('/scenario-stats', getScenarioStatsForAdmin);

scenarioRouter.put('/detail/:id', updateScenario);

scenarioRouter.delete('/detail/:id', deleteScenario);

export default scenarioRouter;
