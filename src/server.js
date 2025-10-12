import express from 'express';
import cors from 'cors';

import { masterOAuth, master1 } from './routes/index.js';
import { originsC, port } from './config.js';

const app = express();

(function () {
	try {
		app.use(
			cors({
				origin: originsC,
				credentials: true,
			})
		);

		app.use(express.json());

		masterOAuth(app);
		master1(app);

		app.listen(port, () => {
			console.log(`[index] Server listening on port ${port}`);
		});
	} catch (e) {
		console.error(`[index] err`, e);
	}
})();
