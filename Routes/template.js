import express from 'express';
import {
  addTemplate,
  deleteTemplate,
  getActiveOtherTemplates,
  getAllTemplates,
  getAllTemplatesByQuery,
  getCustomTemplates,
  getTemplates,
  updateAllTemplateStatus,
  updateOtherTemplateStatus,
  updateTemplate,
  updateTemplateStatus,
} from '../controller/template.js';

const templateRouter = express.Router();
templateRouter.post('/create', addTemplate);
templateRouter.get('/all/', getTemplates);
templateRouter.get('/all/custom', getCustomTemplates);

templateRouter.get('/alltemplates/query', getAllTemplatesByQuery);

templateRouter.delete('/delete/:id', deleteTemplate);
templateRouter.put('/update/:id', updateTemplate);
templateRouter.get('/alltemplates', getAllTemplates);
templateRouter.patch('/status/:id', updateTemplateStatus);
templateRouter.patch('/templatestatus/all', updateAllTemplateStatus);
templateRouter.patch('/templatestatus/all/other', updateOtherTemplateStatus);
templateRouter.get('/allActiveUserTemplates', getActiveOtherTemplates);

export default templateRouter;
