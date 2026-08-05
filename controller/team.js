import mongoose from 'mongoose';
import { TeamModel } from '../Models/Team.js';
import { OrgMemberModel } from '../Models/OrgMember.js';

// Get team(s) for a user (or create default team if none exists)
export const getUserTeams = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const filter = {
      $or: [
        { userId: userId },
        ...(mongoose.Types.ObjectId.isValid(userId) ? [{ userId: new mongoose.Types.ObjectId(userId) }] : []),
      ],
    };

    let teams = await TeamModel.find(filter).sort({ updatedAt: -1 });

    // If user has no team created yet, automatically create default team
    if (!teams || teams.length === 0) {
      const defaultTeam = await TeamModel.create({
        userId: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId,
        name: 'My Team',
        creditsUsed: 0,
        membersCount: 1,
      });
      teams = [defaultTeam];
    }

    return res.status(200).json({ success: true, data: teams });
  } catch (error) {
    console.error('Error fetching user teams:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Create a new team (Enforces 1-team limit)
export const createTeam = async (req, res) => {
  try {
    const { userId, name } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'User ID is required' });
    }

    const filter = {
      $or: [
        { userId: userId },
        ...(mongoose.Types.ObjectId.isValid(userId) ? [{ userId: new mongoose.Types.ObjectId(userId) }] : []),
      ],
    };

    const existingCount = await TeamModel.countDocuments(filter);
    if (existingCount >= 1) {
      return res.status(400).json({
        success: false,
        message: 'You can only have 1 team. You can edit your existing team name.',
      });
    }

    const newTeam = await TeamModel.create({
      userId: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId,
      name: name || 'My Team',
      creditsUsed: 0,
      membersCount: 1,
    });

    return res.status(201).json({ success: true, data: newTeam });
  } catch (error) {
    console.error('Error creating team:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update team name by team _id and sync to organization members
export const updateTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Team name is required' });
    }

    let updatedTeam;
    if (mongoose.Types.ObjectId.isValid(id)) {
      updatedTeam = await TeamModel.findByIdAndUpdate(
        id,
        { name: name.trim() },
        { new: true }
      );
    }

    if (!updatedTeam) {
      const filter = {
        $or: [
          { userId: id },
          ...(mongoose.Types.ObjectId.isValid(id) ? [{ userId: new mongoose.Types.ObjectId(id) }] : []),
        ],
      };
      await TeamModel.updateMany(filter, { name: name.trim() });
      updatedTeam = await TeamModel.findOne(filter);
    }

    if (updatedTeam) {
      const filter = {
        $or: [
          { userId: updatedTeam.userId },
          ...(mongoose.Types.ObjectId.isValid(updatedTeam.userId) ? [{ userId: new mongoose.Types.ObjectId(updatedTeam.userId) }] : []),
        ],
      };
      await TeamModel.updateMany(filter, { name: name.trim() });
      await OrgMemberModel.updateMany(filter, { team: name.trim() });
    }

    return res.status(200).json({ success: true, data: updatedTeam });
  } catch (error) {
    console.error('Error updating team:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update team name by userId directly (fallback)
export const updateUserTeam = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Team name is required' });
    }

    const filter = {
      $or: [
        { userId: userId },
        ...(mongoose.Types.ObjectId.isValid(userId) ? [{ userId: new mongoose.Types.ObjectId(userId) }] : []),
      ],
    };

    await TeamModel.updateMany(filter, { name: name.trim() });
    await OrgMemberModel.updateMany(filter, { team: name.trim() });

    let teams = await TeamModel.find(filter).sort({ updatedAt: -1 });
    if (!teams || teams.length === 0) {
      const newTeam = await TeamModel.create({
        userId: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId,
        name: name.trim(),
        creditsUsed: 0,
        membersCount: 1,
      });
      teams = [newTeam];
    }

    return res.status(200).json({ success: true, data: teams[0] });
  } catch (error) {
    console.error('Error updating user team:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
