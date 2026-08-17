import express from 'express';
import { createTeam, getUserTeams, updateTeam, updateUserTeam } from '../controller/team.js';
import { authMiddleware } from '../middleware/authmiddleware.js';

const teamRouter = express.Router();

teamRouter.get('/getUserTeams/:userId', authMiddleware, getUserTeams);
teamRouter.post('/create', authMiddleware, createTeam);
teamRouter.put('/update/:id', authMiddleware, updateTeam);
teamRouter.put('/updateUserTeam/:userId', authMiddleware, updateUserTeam);

export default teamRouter;
