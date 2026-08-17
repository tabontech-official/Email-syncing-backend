import express from 'express';
import { getLandingPageContent, updateLandingPageContent } from '../controller/landingPageController.js';
import { adminMiddleware } from '../middleware/authmiddleware.js';

const router = express.Router();

router.get('/', getLandingPageContent);
router.put('/', adminMiddleware, updateLandingPageContent);

export default router;
