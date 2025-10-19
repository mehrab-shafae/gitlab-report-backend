import mongoose from 'mongoose';
import { userSchema } from './schema.js';

export const User = mongoose.models.User || mongoose.model('User', userSchema);
