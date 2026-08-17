import express from "express";
import {
  getProductPageContent,
  updateProductPageContent,
} from "../controller/ProductPage.js";
import { adminMiddleware } from "../middleware/authmiddleware.js";

const productPageRouter = express.Router();

productPageRouter.get("/product-page", getProductPageContent);
productPageRouter.put("/product-page", adminMiddleware, updateProductPageContent);

export default productPageRouter;