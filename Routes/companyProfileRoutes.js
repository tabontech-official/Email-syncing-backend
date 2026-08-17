import express from "express";
import {
  getCompanyProfile,
  saveCompanyProfile,
} from "../controller/companyProfileController.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const companyProfileRouter = express.Router();

// --- Authenticated User Endpoints ---
companyProfileRouter.get("/:userId", authMiddleware, getCompanyProfile);
companyProfileRouter.put("/:userId", authMiddleware, saveCompanyProfile);

export default companyProfileRouter;
