import { addListing } from '../controller/equipment.js';
import express from 'express';
import { authMiddleware } from '../middleware/authmiddleware.js';

const listingRouter = express.Router();
listingRouter.post('/', authMiddleware, addListing);

export default listingRouter;
