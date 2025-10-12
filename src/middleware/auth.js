import jwt from 'jsonwebtoken';
import { DEV_MODE, JWT_SECRET, adminUser } from '../config.js';
import { fetchGitlabUsers } from '../utils.js';

export default async (req, res, next) => {
	try {
		if (DEV_MODE) {
			req.auth = { isAdmin: true, username: adminUser };
			return next();
		}

		const authHeader = req.headers['authorization'] || '';
		const tokenStr = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.headers['x-access-token'] || '').toString();

		if (!tokenStr) {
			return res.status(401).json({ message: 'توکن ارائه نشده است' });
		}

		let claims;
		try {
			claims = jwt.verify(tokenStr, JWT_SECRET);
		} catch (e) {
			return res.status(401).json({ message: 'توکن نامعتبر است' });
		}

		const isAdmin = Boolean(claims?.isAdmin) && claims?.username === adminUser;

		if (!isAdmin) {
			if (!claims?.username) {
				return res.status(403).json({ message: 'کاربر در توکن مشخص نیست' });
			}

			let users;
			try {
				users = await fetchGitlabUsers();
			} catch (err) {
				return res.status(502).json({ message: 'خطا در دریافت کاربران GitLab' });
			}

			const matched = users.find(u => String(u?.username).toLowerCase() === String(claims.username).toLowerCase());
			if (!matched) {
				return res.status(403).json({ message: 'یوزر اشتباه است یا در GitLab یافت نشد' });
			}

			// Enforce self-access by userId in query for enforced routes
			const selfId = String(matched.id);

			// Reject attempts to impersonate via query/params/body
			const qUserId = req.query?.userId ? String(req.query.userId) : undefined;
			const pId = req.params?.id ? String(req.params.id) : undefined;
			const bUserId = req.body?.userId ? String(req.body.userId) : undefined;

			if ((qUserId && qUserId !== selfId) || (pId && pId !== selfId) || (bUserId && bUserId !== selfId)) {
				return res.status(403).json({ message: 'به داده‌های سایر کاربران دسترسی ندارید' });
			}

			// Auto-scope if userId not present
			if (!qUserId) {
				req.query.userId = selfId;
			}
			if (req.body && !bUserId) {
				req.body.userId = selfId;
			}

			req.auth = { isAdmin: false, username: claims.username, gitlabUserId: matched.id };
		} else {
			req.auth = { isAdmin: true, username: claims.username };
		}

		return next();
	} catch (err) {
		return res.status(500).json({ message: 'خطای داخلی در احراز هویت', error: err?.message || String(err) });
	}
};
