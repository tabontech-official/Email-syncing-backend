import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const authSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: [/\S+@\S+\.\S+/, 'Please use a valid email address'],
    },
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters long'],
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    selectedPlatform: { type: String, enum: ['shopify', 'other'] },
    mailhook: { type: String },
    isVerified: { type: Boolean, default: false },
    locked: {
      type: Boolean,
      default: false,
    },
    setup: {
      stepCompleted: { type: Number, default: 0 },
     
      tone: String,
      services: [String],
      sendingMode: { type: String, default: 'Auto-Send' },
      followUps: {
        first: { delay: Number, unit: String },
        second: { delay: Number, unit: String },
      },
      safetyNet: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

// Password hashing before saving to the database
authSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next(); // Only hash if the password has been modified

  const salt = await bcrypt.genSalt(10); // Generates salt
  this.password = await bcrypt.hash(this.password, salt); // Hash the password
  next();
});

// Password comparison method
authSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password); // Compares hashed password with entered password
  } catch (error) {
    throw new Error('Error comparing passwords');
  }
};

export const authModel = mongoose.model('User', authSchema);
