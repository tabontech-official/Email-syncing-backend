import express from "express"
import { talkToSales } from "../controller/talkToSales.js"



const SalesRouter=express.Router()
SalesRouter.post("/talk-to-sales",talkToSales)

export default SalesRouter