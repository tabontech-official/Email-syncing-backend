import express from 'express';
import { addNotification, getNotificationByUserId, updateSeen } from '../controller/notification.js';
import { authMiddleware } from '../middleware/authmiddleware.js';

const notificationRouter = express.Router();
notificationRouter.post('/addNotofication', authMiddleware, addNotification);
notificationRouter.get("/getNotificationByUserId/:userId", authMiddleware, getNotificationByUserId);
notificationRouter.put('/markAllSeen/:userId', authMiddleware, updateSeen);

export default notificationRouter;