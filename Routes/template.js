import express from 'express';
import {
  addTemplate,
  deleteTemplate,
  generateTemplateWithAI,
  getActiveOtherTemplates,
  getAllTemplates,
  getAllTemplatesByQuery,
  getTemplateResolution,
  getCustomTemplates,
  getTemplates,
  saveOtherTemplate,
  toggleAllTemplatesAi,
  toggleTemplateAi,
  updateAllTemplateStatus,
  updateOtherTemplateStatus,
  updateTemplate,
  updateTemplateStatus,
  toggleTemplateAiResponse,
  bulkToggleTemplateAiResponse,
  restoreDefaultTemplates,
} from '../controller/template.js';

import { authMiddleware } from '../middleware/authmiddleware.js';

const templateRouter = express.Router();

// --- Authenticated User Endpoints ---
templateRouter.post('/create', authMiddleware, addTemplate);
templateRouter.get('/all/', authMiddleware, getTemplates);
templateRouter.post('/restore-defaults', authMiddleware, restoreDefaultTemplates);
templateRouter.get('/all/custom', authMiddleware, getCustomTemplates);
templateRouter.post('/save/other', authMiddleware, saveOtherTemplate);
templateRouter.get('/alltemplates/query', authMiddleware, getAllTemplatesByQuery);
/*
 * The one question the Send Test panel is allowed to ask about template
 * activation. Answered by the same resolver the send path uses, so the
 * warning modal cannot contradict what the engine does.
 */
templateRouter.get('/resolution', authMiddleware, getTemplateResolution);
templateRouter.delete('/delete/:id', authMiddleware, deleteTemplate);
templateRouter.put('/update/:id', authMiddleware, updateTemplate);
templateRouter.get('/alltemplates', authMiddleware, getAllTemplates);
templateRouter.patch('/status/:id', authMiddleware, updateTemplateStatus);
templateRouter.patch('/ai-toggle/:id', authMiddleware, toggleTemplateAiResponse);
templateRouter.patch('/ai-toggle-all', authMiddleware, bulkToggleTemplateAiResponse);
templateRouter.patch('/templatestatus/all', authMiddleware, updateAllTemplateStatus);
templateRouter.patch('/templatestatus/all/other', authMiddleware, updateOtherTemplateStatus);
templateRouter.get('/other/active', authMiddleware, getActiveOtherTemplates);
templateRouter.post("/ai/generate", authMiddleware, generateTemplateWithAI);
templateRouter.patch('/ai-toggle/:id', authMiddleware, toggleTemplateAi);
templateRouter.patch('/ai-toggle-all', authMiddleware, toggleAllTemplatesAi);

export default templateRouter;
