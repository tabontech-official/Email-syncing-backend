import express from "express";
import { getAiConfig, updateAiConfig } from "../controller/aiConfigController.js";

const aiConfigRouter = express.Router();

aiConfigRouter.get("/", getAiConfig);
aiConfigRouter.put("/", updateAiConfig);

export default aiConfigRouter;
