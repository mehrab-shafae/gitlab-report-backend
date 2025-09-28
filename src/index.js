import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import cors from "cors";
import { apiRouter } from './routes/index.js';


dotenv.config();
const app = express();

//cors
app.use(cors({
  origin : ['http://localhost:3000' , 'http://localhost:3001' , 'https://gitlabreport.forvestlab.ir'] ,
  credentials : true ,
}));

// Parse JSON bodies
app.use(express.json());

// Routers
app.use('/', apiRouter);

// MongoDB connection
const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
mongoose.connect(mongoUri, { dbName: process.env.MONGODB_DB || 'forvest_git' })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err.message));

// Models
import { User } from './models/User.js';

// Users route moved to users router
// Labels route moved to labels router


// Auth routes using MongoDB
app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'username و password الزامی هستند' });
    }

    const user = await User.findOne({ username, password }).lean();
    if (!user) {
      return res.status(401).json({ status: 'error', message: 'نام کاربری یا رمز عبور اشتباه است' });
    }

    return res.json({ status: 'ok', message: 'ورود موفق بود' , user });
  } catch (error) {
    return res.status(500).json({ message: 'خطا در بررسی ورود', error: error?.message || String(error) });
  }
});

app.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'username و password الزامی هستند' });
    }

    const exists = await User.exists({ username });
    if (exists) {
      return res.status(409).json({ message: 'این نام کاربری قبلاً ثبت شده است' });
    }

    const created = await User.create({ username, password });
    return res.status(201).json({ status: 'ok', id: created._id });
  } catch (error) {
    return res.status(500).json({ message: 'خطا در ثبت کاربر', error: error?.message || String(error) });
  }
});


const port = process.env.PORT || 3000;
app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
}); 


