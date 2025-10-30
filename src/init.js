import './log.js';

import './cwd.js';
import './asyncHandler.js';

import mongoose from 'mongoose';
import { onShutdown } from './shutdown.js';

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const dbName = process.env.MONGODB_DB || 'forvest_git';

(async function () {
      try {
            await mongoose.connect(mongoUri, {
                  dbName,
                  authSource: 'admin', // TODO("Static?")
                  socketTimeoutMS: 60000,
                  serverSelectionTimeoutMS: 60000,
                  minPoolSize: 5,
                  maxPoolSize: 20,
            });
            console.log('[info] MongoDB connected.');
      } catch (err) {
            console.error('[error] MongoDB connection failed:', err);
            process.exit(1);
      }
})();

async function closeGracefully(signal) {
      try {
            await mongoose.connection.close(false); // false = close without forcing immediate close
            console.log(`[info] MongoDB disconnected due to ${signal || 'shutdown'}.`);
      } catch (err) {
            console.error('[error] Error during MongoDB disconnect:', err);
      }
}

onShutdown(async () => {
      await closeGracefully();
});
