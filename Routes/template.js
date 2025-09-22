import express from "express"
import {  addTemplate, deleteTemplate, getTemplates, updateTemplate } from "../controller/template.js";


const templateRouter=express.Router()
templateRouter.post('/create',addTemplate)
templateRouter.get("/all/",getTemplates)
templateRouter.delete("/delete/:id",deleteTemplate)
templateRouter.put("/update/:id", updateTemplate);


export default templateRouter;