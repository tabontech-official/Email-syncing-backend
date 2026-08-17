import express from "express";
import { createConnection } from "../controller/connection.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const connectionRouter = express.Router();

connectionRouter.post("/create", authMiddleware, createConnection);

export default connectionRouter;