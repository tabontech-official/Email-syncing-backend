import express from 'express';
import jwt from 'jsonwebtoken';
import { getLandingPageContent, updateLandingPageContent } from '../controller/landingPageController.js';
import { authModel } from "../Models/auth.js"; // note: auth.js exports authModel

const router = express.Router();

const verifyAdminJwt = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.split(' ')[1];
    
    const decoded = jwt.verify(token, process.env.SECRET_KEY || 'your_jwt_secret'); 
    
    const userId = decoded.payLoad ? decoded.payLoad._id : decoded._id;
    
    const user = await authModel.findById(userId);
    if (user && user.role === 'admin') {
      req.userId = userId;
      next();
    } else {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }
  } catch (error) {
    console.error('Admin Auth Error:', error);
    return res.status(401).json({ error: "Invalid token" });
  }
};

router.get('/', getLandingPageContent);
router.put('/', verifyAdminJwt, updateLandingPageContent);

export default router;
