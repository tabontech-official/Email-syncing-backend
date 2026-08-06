import express from 'express';
import {
  addTemplate,
  deleteTemplate,
  generateTemplateWithAI,
  getActiveOtherTemplates,
  getAllTemplates,
  getAllTemplatesByQuery,
  getCustomTemplates,
  getTemplates,
  saveOtherTemplate,
  updateAllTemplateStatus,
  updateOtherTemplateStatus,
  updateTemplate,
  updateTemplateStatus,
  toggleTemplateAiResponse,
  bulkToggleTemplateAiResponse,
} from '../controller/template.js';

const templateRouter = express.Router();
templateRouter.post('/create', addTemplate);
templateRouter.get('/all/', getTemplates);
templateRouter.get('/all/custom', getCustomTemplates);
templateRouter.post('/save/other', saveOtherTemplate);

templateRouter.get('/alltemplates/query', getAllTemplatesByQuery);

templateRouter.delete('/delete/:id', deleteTemplate);
templateRouter.put('/update/:id', updateTemplate);
templateRouter.get('/alltemplates', getAllTemplates);
templateRouter.patch('/status/:id', updateTemplateStatus);
templateRouter.patch('/ai-toggle/:id', toggleTemplateAiResponse);
templateRouter.patch('/ai-toggle-all', bulkToggleTemplateAiResponse);
templateRouter.patch('/templatestatus/all', updateAllTemplateStatus);
templateRouter.patch('/templatestatus/all/other', updateOtherTemplateStatus);
templateRouter.get('/other/active', getActiveOtherTemplates);
templateRouter.post("/ai/generate", generateTemplateWithAI);

export default templateRouter;
