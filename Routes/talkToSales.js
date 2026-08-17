import express from "express"
import { talkToSales } from "../controller/talkToSales.js"
import { publicFormLimiter } from "../middleware/rateLimiter.js"

const SalesRouter=express.Router()
SalesRouter.post("/talk-to-sales", publicFormLimiter, talkToSales)

export default SalesRouter