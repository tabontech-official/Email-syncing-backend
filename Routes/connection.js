import express from "express"
import mongoose from "mongoose"
import { createConnection } from "../controller/connection.js";


const connectionRouter=express.Router()

connectionRouter.post("/create", createConnection)


export default connectionRouter;