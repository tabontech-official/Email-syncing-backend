import express from "express";
import { getHistory } from "../controller/scenarioRunLogRoutes.js";

const scenarioRunLogRouter = express.Router();

scenarioRunLogRouter.get("/history/:scenarioId", getHistory);

export default scenarioRunLogRouter;