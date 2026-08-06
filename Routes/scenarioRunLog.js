import express from "express";
import { getHistory, getUserAiRepliesLogs } from "../controller/scenarioRunLogRoutes.js";

const scenarioRunLogRouter = express.Router();

scenarioRunLogRouter.get("/history/:scenarioId", getHistory);
scenarioRunLogRouter.get("/user/:userId", getUserAiRepliesLogs);

export default scenarioRunLogRouter;