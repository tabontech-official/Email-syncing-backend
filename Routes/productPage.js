import express from "express";
import {
  getProductPageContent,
  updateProductPageContent,
} from "../controller/ProductPage.js";

const productPageRouter = express.Router();

productPageRouter.get("/product-page", getProductPageContent);
productPageRouter.put("/product-page", updateProductPageContent);

export default productPageRouter;