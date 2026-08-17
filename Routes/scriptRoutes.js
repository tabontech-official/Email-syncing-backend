import express from 'express';
import { getScripts, saveScripts } from '../controller/scriptController.js';
import { adminMiddleware } from '../middleware/authmiddleware.js';

const scriptRouter = express.Router();

// Public route for frontend rendering
scriptRouter.get('/', getScripts);

// Admin only
scriptRouter.put('/', adminMiddleware, saveScripts);

export default scriptRouter;
