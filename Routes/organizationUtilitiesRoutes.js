import express from 'express';
import {
  saveOrganizationUtilities,
  getOrganizationUtilities,
  savePaymentMethod,
  getPaymentMethod,
} from '../controller/organizationUtilitiesController.js';

const router = express.Router();

router.post('/utilities/:userId', saveOrganizationUtilities);
router.get('/utilities/:userId', getOrganizationUtilities);

router.post('/payment-method/:userId', savePaymentMethod);
router.get('/payment-method/:userId', getPaymentMethod);

export default router;
