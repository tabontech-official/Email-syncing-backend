import { addMultipleStores, generateAcessKeys, getApiCredentialByUserId, getStores } from "../controller/apicredential.js";
import express from 'express'
import { authMiddleware } from "../middleware/authmiddleware.js";

const apiCredentialsRouter = express.Router();

apiCredentialsRouter.post('/generate-keys', authMiddleware, generateAcessKeys);
apiCredentialsRouter.get('/getApiCredentialByUserId/:userId', authMiddleware, getApiCredentialByUserId);
apiCredentialsRouter.post('/', authMiddleware, addMultipleStores);
apiCredentialsRouter.get('/getStores', authMiddleware, getStores);

export default apiCredentialsRouter;