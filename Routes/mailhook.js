import express from 'express';
import { addMailhookCard, deleteMailhookCard, getMailhookCard } from '../controller/mailhook.js';
import { authMiddleware } from '../middleware/authmiddleware.js';

const mailhookRouter = express.Router();
mailhookRouter.get("/:userId", authMiddleware, getMailhookCard);
mailhookRouter.post("/create", authMiddleware, addMailhookCard);
mailhookRouter.delete("/mailhookcard/:cardId", authMiddleware, deleteMailhookCard);

export default mailhookRouter;