import { adminUser, USERS_GIT } from '../../config.js';
import { User } from '../../model/user.js';

			// const matched = users.find(u => String(u?.username).toLowerCase() === String(claims.username).toLowerCase());
			// if (!matched) {
			// 	return res.status(403).json({ message: 'یوزر اشتباه است یا در GitLab یافت نشد' });
			// }

export async function register(username, password) {
	try {
		if (!username || !password) return false;

		const matched = USERS_GIT.find(u => String(u?.username).toLowerCase() === String(claims.username).toLowerCase());
			if (!matched) {
				return false;
			}

		const exists = await User.exists({ username });
		if (exists) {
			return true;
		}

		if (username === adminUser) {
			await User.create({ username, password, isAdmin: true });
		} else {
			await User.create({ username, password });
		}

		return true;
	} catch (error) {
		console.log('[register] error:', error);
		return false;
	}
};
