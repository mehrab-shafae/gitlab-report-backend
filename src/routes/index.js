import express from 'express';
import { milestonesRouter } from './milestones.js';
import { usersRouter } from './users.js';
import { labelsRouter } from './labels.js';
import { reportsRouter } from './reports.js';

export const apiRouter = express.Router();

apiRouter.use('/milestones', milestonesRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/labels', labelsRouter);
apiRouter.use('/', reportsRouter);


