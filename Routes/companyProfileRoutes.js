import express from "express";
import {
  getCompanyProfile,
  saveCompanyProfile,
  listCompanyProfiles,
  createCompanyProfile,
  getCompanyProfileById,
  updateCompanyProfileById,
  setDefaultCompanyProfile,
  setCompanyProfileActive,
  deleteCompanyProfile,
} from "../controller/companyProfileController.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const companyProfileRouter = express.Router();

/*
 * Per-profile routes are declared before the /:userId ones: "detail" would
 * otherwise be captured as a userId and every request would 400 on the
 * ObjectId check.
 */
companyProfileRouter.get("/detail/:profileId", authMiddleware, getCompanyProfileById);
companyProfileRouter.put("/detail/:profileId", authMiddleware, updateCompanyProfileById);
companyProfileRouter.patch("/detail/:profileId/default", authMiddleware, setDefaultCompanyProfile);
companyProfileRouter.patch("/detail/:profileId/active", authMiddleware, setCompanyProfileActive);
companyProfileRouter.delete("/detail/:profileId", authMiddleware, deleteCompanyProfile);

companyProfileRouter.get("/:userId/list", authMiddleware, listCompanyProfiles);
companyProfileRouter.post("/:userId", authMiddleware, createCompanyProfile);

/* Legacy single-profile routes — these act on the user's default profile. */
companyProfileRouter.get("/:userId", authMiddleware, getCompanyProfile);
companyProfileRouter.put("/:userId", authMiddleware, saveCompanyProfile);

export default companyProfileRouter;
