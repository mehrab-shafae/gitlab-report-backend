// >>> MRB <<< //
// #### --> MRB <-- ### //
import jwt from 'jsonwebtoken';
import { adminUser, JWT_SECRET } from '../../config.js';
import { User } from '../../model/user.js';
import { register } from './register.js';

export default async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'username و password الزامی هستند' });
    }

    const reg = await register(username, password);
    if (!reg) {
      return res.status(500).json({
        status: 'error',
        message: 'نام کاربری یا رمز عبور اشتباه است',
      });
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
    console.log('[login] error:', error);
    return res.status(500).json({
      message: 'خطا در بررسی ورود',
      error: error?.message || String(error),
    });
  }
};
// #### --> MRB <-- ### //
// *** MRB *** //
