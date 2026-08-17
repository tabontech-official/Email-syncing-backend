import express from 'express';
import {
  createCategory,
  delet,
  deleteCollection,
  exportCsvForCategories,
  getCategory,
  getCollectionData,
  getSingleCategory,
} from '../controller/category.js';
import { cpUpload } from '../middleware/cloudinary.js';
import { authMiddleware } from '../middleware/authmiddleware.js';

const categoryRouter = express.Router();
categoryRouter.post('/createCategory', authMiddleware, cpUpload, createCategory);

categoryRouter.get('/getCategory', authMiddleware, getCategory);
categoryRouter.get('/getCollection/:userId', authMiddleware, getCollectionData);
categoryRouter.get('/category/:categoryId', authMiddleware, getSingleCategory);
categoryRouter.get('/getCsvForCategories', authMiddleware, exportCsvForCategories);
categoryRouter.delete('/deleteCategory', authMiddleware, deleteCollection);
categoryRouter.delete('/', authMiddleware, delet);
export default categoryRouter;
