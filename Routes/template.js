import express from "express"
import { addOtherTemplate, addTemplate, deleteTemplate, getTemplates } from "../controller/template.js";


const templateRouter=express.Router()
templateRouter.post('/addTemplates',addTemplate)
templateRouter.get("/fetchTemplate/:platform",getTemplates)
templateRouter.delete("/delete",deleteTemplate)
templateRouter.post('/addOtherTemplates',addOtherTemplate)


export default templateRouter;