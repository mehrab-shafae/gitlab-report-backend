import login from './Auth/login.js';
import register from './Auth/register.js';

export default function (app) {
	app.post('/login', asyncHandler(login));

	app.post('/register', asyncHandler(register));
}
