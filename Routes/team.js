import express from 'express';
import { createTeam, getUserTeams, updateTeam, updateUserTeam } from '../controller/team.js';

const teamRouter = express.Router();

teamRouter.get('/getUserTeams/:userId', getUserTeams);
teamRouter.post('/create', createTeam);
teamRouter.put('/update/:id', updateTeam);
teamRouter.put('/updateUserTeam/:userId', updateUserTeam);

export default teamRouter;
