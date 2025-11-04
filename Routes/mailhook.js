import express from 'express'
import { addMailhookCard, deleteMailhookCard, getMailhookCard } from '../controller/mailhook.js'

const mailhookRouter=express.Router()
mailhookRouter.get("/:userId",getMailhookCard)
mailhookRouter.post("/create",addMailhookCard)
mailhookRouter.delete("/mailhookcard/:cardId", deleteMailhookCard);



export default mailhookRouter