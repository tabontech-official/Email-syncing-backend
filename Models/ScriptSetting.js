import mongoose from "mongoose";

const scriptSettingSchema = new mongoose.Schema(
  {
    headerScript: {
      type: String,
      default: "",
    },
    footerScript: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export const ScriptSetting =
  mongoose.models.ScriptSetting ||
  mongoose.model("ScriptSetting", scriptSettingSchema);