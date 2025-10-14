import mongoose from 'mongoose';
import { userSchema } from '../../modelSchema.js';

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default async (req, res) => {
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
};
