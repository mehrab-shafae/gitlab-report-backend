// *** MRB *** //
// #### --> MRB <-- ### //
import express from 'express';
import cors from 'cors';

import { masterOAuth, master1 } from './routes/index.js';
import { originsC, port } from './config.js';

const app = express();

(function () {
  try {
    console.info('[gitlab-report]: Setting up Express middleware');
    
    app.use(
      cors({
        origin: originsC,
        credentials: true,
      })
    );

    app.use(express.json());

    console.info('[gitlab-report]: Registering route handlers');
    masterOAuth(app);
    master1(app);

    const server = app.listen(port, () => {
      console.info(`[gitlab-report]: Service started successfully`);
      console.info(`[gitlab-report]: Server listening on port ${port}`);
      console.info(`[gitlab-report]: Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.warn('[gitlab-report]: SIGTERM signal received: closing gracefully');
      server.close(() => {
        console.info('[gitlab-report]: HTTP server closed');
        process.exit(0);
      });
      setTimeout(() => {
        console.error('[gitlab-report]: Forced shutdown after 2-second timeout');
        process.exit(1);
      }, 2000);
    });

    process.on('SIGINT', () => {
      console.warn('[gitlab-report]: SIGINT signal received: closing gracefully');
      server.close(() => {
        console.info('[gitlab-report]: HTTP server closed');
        process.exit(0);
      });
      setTimeout(() => {
        console.error('[gitlab-report]: Forced shutdown after 2-second timeout');
        process.exit(1);
      }, 2000);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      console.error('[gitlab-report]: Uncaught exception:', err.message);
      console.error('[gitlab-report]: Stack:', err.stack);
      server.close(() => {
        process.exit(1);
      });
      setTimeout(() => {
        process.exit(1);
      }, 2000);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[gitlab-report]: Unhandled promise rejection:', reason);
      server.close(() => {
        process.exit(1);
      });
      setTimeout(() => {
        process.exit(1);
      }, 2000);
    });
  } catch (e) {
    console.error(`[gitlab-report]: Fatal error during initialization:`, e.message);
    console.error('[gitlab-report]: Stack:', e.stack);
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  }
})();
// #### --> MRB <-- ### //
