import mongoose from 'mongoose';
import { userSchema } from './modelSchema.js';
import { JWT_SECRET } from './config.js';
import jwt from 'jsonwebtoken';

const User = mongoose.models.User || mongoose.model('User', userSchema);

export function masterOAuth(app) {
      app.post('/login', async (req, res) => {
            try {
                  const { username, password } = req.body || {};
                  if (!username || !password) {
                        return res.status(400).json({ message: 'username و password الزامی هستند' });
                  }

                  const user = await User.findOne({ username, password }).lean();
                  if (!user) {
                        return res.status(401).json({
                              status: 'error',
                              message: 'نام کاربری یا رمز عبور اشتباه است',
                        });
                  }

                  const payload = {
                        sub: String(user._id),
                        username: user.username,
                        isAdmin: Boolean(user.isAdmin) && user.username === adminUser,
                  };
                  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

                  return res.json({ status: 'ok', message: 'ورود موفق بود', accessToken, user: payload });
            } catch (error) {
                  return res.status(500).json({
                        message: 'خطا در بررسی ورود',
                        error: error?.message || String(error),
                  });
            }
      });

      app.post('/register', async (req, res) => {
            try {
                  const { username, password } = req.body || {};
                  if (!username || !password) {
                        return res.status(400).json({ message: 'username و password الزامی هستند' });
                  }

                  const exists = await User.exists({ username });
                  if (exists) {
                        return res.status(409).json({ message: 'این نام کاربری قبلاً ثبت شده است' });
                  }

                  let created;

                  if (username === adminUser) {
                        created = await User.create({ username, password, isAdmin: true });
                  } else {
                        created = await User.create({ username, password });
                  }

                  return res.status(201).json({ status: 'ok', id: created._id });
            } catch (error) {
                  return res.status(500).json({
                        message: 'خطا در ثبت کاربر',
                        error: error?.message || String(error),
                  });
            }
      });
}
