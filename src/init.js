import mongoose from 'mongoose';

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';

(async () => {
      await mongoose.connect(mongoUri, {
            dbName: process.env.MONGODB_DB || 'forvest_git',
            authSource: 'admin',
            socketTimeoutMS: 60000,
            serverSelectionTimeoutMS: 60000,
            minPoolSize: 5,
            maxPoolSize: 20,
      });
      console.log('[init] MongoDB connected.');
})();
