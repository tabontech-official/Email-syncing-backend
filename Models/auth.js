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
      lowercase: true,  // Ensures email is always lowercase
      match: [/\S+@\S+\.\S+/, 'Please use a valid email address'], // Simple regex to validate email format
    },
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters long'], // Add minimum length validation
    },
    roe: {
      type: String,
      enum: ['user', 'admin'], // Ensure the role can only be 'user' or 'admin'
      default: 'user',
    },
        googleId: { type: String, required: true, unique: true },
   tokens: {
        access_token: { type: String },
        refresh_token: { type: String },
        scope: { type: String },
        token_type: { type: String },
        expiry_date: { type: Number }
    }
  },
  {
    timestamps: true,
  }
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
