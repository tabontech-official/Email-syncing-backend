import { authModel } from "../Models/auth.js";
import { mailhookModel } from "../Models/MailhookSchema.js";
import { validationModel } from "../Models/ValidationEmail.js";
import mongoose from "mongoose";
export const addMailhookCard = async (req, res) => {
  try {
    const { userId, forwardingEmail } = req.body;

   

    const user = await authModel.findById(userId).select("mailhook email");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.mailhook) {
      return res.status(400).json({
        success: false,
        message: "User does not have a mailhook yet",
      });
    }

    const newMailhook = new mailhookModel({
      userId,
      mailhook: user.mailhook,
      forwardingEmail,
    });

    await newMailhook.save();

    res.status(201).json({
      success: true,
      message: "Mailhook created successfully",
      data: newMailhook,
    });
  } catch (error) {
    console.error("Error creating mailhook:", error);
    res.status(500).json({
      success: false,
      message: "Server error creating mailhook",
    });
  }
};


export const getMailhookCard = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const mailhooks = await mailhookModel.find({ userId }).sort({ createdAt: -1 });

    if (!mailhooks.length) {
      return res.status(404).json({
        success: false,
        message: "No mailhook records found for this user",
      });
    }

    res.status(200).json({
      success: true,
      count: mailhooks.length,
      data: mailhooks,
    });
  } catch (error) {
    console.error("Error fetching mailhooks:", error);
    res.status(500).json({
      success: false,
      message: "Server error fetching mailhooks",
    });
  }
};


export const deleteMailhookCard = async (req, res) => {
  try {
    const { cardId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Mailhook card ID.",
      });
    }

    const mailhook = await mailhookModel.findById(cardId);

    if (!mailhook) {
      return res.status(404).json({
        success: false,
        message: "Mailhook card not found.",
      });
    }

    if (mailhook.validationId) {
      const deletedValidation = await validationModel.findByIdAndDelete(
        mailhook.validationId
      );
      if (deletedValidation) {
        console.log(
          `🗑️ Deleted validation email with ID ${mailhook.validationId}`
        );
      }
    }

    await mailhookModel.findByIdAndDelete(cardId);

    console.log(`✅ Mailhook card deleted: ${cardId}`);

    return res.status(200).json({
      success: true,
      message: "Mailhook card and linked validation record deleted successfully.",
    });
  } catch (error) {
    console.error("❌ Error deleting mailhook card:", error);
    return res.status(500).json({
      success: false,
      message: "Server error deleting mailhook card.",
      error: error.message,
    });
  }
};