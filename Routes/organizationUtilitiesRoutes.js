import express from 'express';
import {
  saveOrganizationUtilities,
  getOrganizationUtilities,
  savePaymentMethod,
  getPaymentMethod,
} from '../controller/organizationUtilitiesController.js';
import { authMiddleware } from '../middleware/authmiddleware.js';

const router = express.Router();

router.post('/utilities/:userId', authMiddleware, saveOrganizationUtilities);
router.get('/utilities/:userId', authMiddleware, getOrganizationUtilities);

router.post('/payment-method/:userId', authMiddleware, savePaymentMethod);
router.get('/payment-method/:userId', authMiddleware, getPaymentMethod);

export default router;
