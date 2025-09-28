import express from 'express';
import getUsers from '../utils/getUsers.js';

export const usersRouter = express.Router();

usersRouter.get('/', async (req, res) => {
	try {
		const data = await getUsers();
		const activeUser = data.filter(user => !!user.state);
		res.json({ status: 'success', data: activeUser });
	} catch (e) {
		res.status(500).json({ message: 'Failed to fetch users', error: e?.message || String(e) });
	}
});


