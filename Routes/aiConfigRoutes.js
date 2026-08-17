import express from "express";
import { getAiConfig, updateAiConfig } from "../controller/aiConfigController.js";
import { adminMiddleware } from "../middleware/authmiddleware.js";

const aiConfigRouter = express.Router();

// --- Admin-Only Endpoints ---
aiConfigRouter.get("/", adminMiddleware, getAiConfig);
aiConfigRouter.put("/", adminMiddleware, updateAiConfig);

export default aiConfigRouter;
