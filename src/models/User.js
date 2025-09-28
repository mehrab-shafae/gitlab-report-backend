import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  isAdmin: { type: Boolean },
}, { timestamps: true });

export const User = mongoose.models.User || mongoose.model('User', userSchema);


