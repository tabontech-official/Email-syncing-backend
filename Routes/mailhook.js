import express from 'express';
import { addMailhookCard, deleteMailhookCard, getMailhookCard, validateMailhookCard } from '../controller/mailhook.js';
import { authMiddleware } from '../middleware/authmiddleware.js';

const mailhookRouter = express.Router();
mailhookRouter.get("/:userId", authMiddleware, getMailhookCard);
mailhookRouter.post("/create", authMiddleware, addMailhookCard);
mailhookRouter.post("/validate", authMiddleware, validateMailhookCard);
mailhookRouter.delete("/mailhookcard/:cardId", authMiddleware, deleteMailhookCard);

export default mailhookRouter;