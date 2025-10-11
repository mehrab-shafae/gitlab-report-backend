import mongoose from 'mongoose';

export const userSchema = new mongoose.Schema(
      {
            username: { type: String, required: true, unique: true, trim: true },
            password: { type: String, required: true },
            isAdmin: { type: Boolean, default: false },
      },
      { timestamps: true }
);
