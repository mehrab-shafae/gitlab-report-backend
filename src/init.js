// *** MRB *** //
// #### --> MRB <-- ### //
import './log.js';

import './cwd.js';
import './asyncHandler.js';

import mongoose from 'mongoose';
import { onShutdown } from './shutdown.js';

const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const dbName = process.env.MONGODB_DB || 'forvest_git';

console.info('[gitlab-report]: Initializing service');
console.info(`[gitlab-report]: Environment: ${process.env.NODE_ENV || 'development'}`);
console.info('[gitlab-report]: Connecting to MongoDB');
console.info(`[gitlab-report]: MongoDB URI configured: ${mongoUri ? 'Yes (hidden)' : 'No'}`);
console.info(`[gitlab-report]: Database name: ${dbName}`);

(async function () {
  try {
    await mongoose.connect(mongoUri, {
      dbName,
      authSource: 'admin',
      socketTimeoutMS: 60000,
      serverSelectionTimeoutMS: 60000,
      minPoolSize: 5,
      maxPoolSize: 20,
    });
    
    console.info('[gitlab-report]: MongoDB connection established successfully');
    console.info('[gitlab-report]: Pool size: 5-20 connections');
    console.info('[gitlab-report]: Mongoose connection state:', mongoose.connection.readyState);
  } catch (err) {
    console.error('[gitlab-report]: MongoDB connection failed:', err.message);
    console.error('[gitlab-report]: Mongoose connection state:', mongoose.connection.readyState);
    console.error('[gitlab-report]: Initiating graceful shutdown with 2-second delay');
    setTimeout(() => {
      process.exit(1);
    }, 2000);
  }
})();

async function closeGracefully(signal) {
  try {
    console.info(`[gitlab-report]: Closing MongoDB connection due to ${signal || 'shutdown'}...`);
    await mongoose.connection.close(false);
    console.info('[gitlab-report]: MongoDB connection closed successfully');
  } catch (err) {
    console.error('[gitlab-report]: Error during MongoDB disconnect:', err.message);
  }
}

onShutdown(async () => {
  await closeGracefully();
});
// #### --> MRB <-- ### //
