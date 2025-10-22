import express from 'express';
import {
  addTemplate,
  deleteTemplate,
  getAllTemplates,
  getTemplates,
  updateAllTemplateStatus,
  updateTemplate,
  updateTemplateStatus,
} from '../controller/template.js';

const templateRouter = express.Router();
templateRouter.post('/create', addTemplate);
templateRouter.get('/all/', getTemplates);
templateRouter.delete('/delete/:id', deleteTemplate);
templateRouter.put('/update/:id', updateTemplate);
templateRouter.get('/alltemplates', getAllTemplates);
templateRouter.patch('/status/:id', updateTemplateStatus);
templateRouter.patch('/templatestatus/all', updateAllTemplateStatus);

export default templateRouter;
