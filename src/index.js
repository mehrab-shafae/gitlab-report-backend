import 'dotenv/config';
import './log.js';

import './init.js';

import express from 'express';
import cors from 'cors';

import { masterOAuth } from './auth.js';
import { originsC, port } from './config.js';
import { master1 } from './routes.js';

const app = express();

(function main() {
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
