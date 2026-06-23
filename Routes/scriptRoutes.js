import express from 'express';
import { getScripts, saveScripts } from '../controller/scriptController.js';

const scriptRouter = express.Router();

// Public route for frontend rendering
scriptRouter.get('/', getScripts);

// Admin only
scriptRouter.put(
  '/',
  // verifyToken,
  // isAdmin,
  saveScripts
);

export default scriptRouter;
