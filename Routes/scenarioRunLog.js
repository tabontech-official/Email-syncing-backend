import express from "express";
import { getHistory, getUserAiRepliesLogs } from "../controller/scenarioRunLogRoutes.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const scenarioRunLogRouter = express.Router();

scenarioRunLogRouter.get("/history/:scenarioId", authMiddleware, getHistory);
scenarioRunLogRouter.get("/user/:userId", authMiddleware, getUserAiRepliesLogs);

export default scenarioRunLogRouter;