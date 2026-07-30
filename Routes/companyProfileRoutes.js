import express from "express";
import {
  getCompanyProfile,
  saveCompanyProfile,
} from "../controller/companyProfileController.js";

const companyProfileRouter = express.Router();

companyProfileRouter.get("/:userId", getCompanyProfile);
companyProfileRouter.put("/:userId", saveCompanyProfile);

export default companyProfileRouter;
