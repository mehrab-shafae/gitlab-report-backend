// *** MRB *** //
// #### --> MRB <-- ### //
import express from 'express';
import { listMilestones } from '../controllers/milestonesController.js';
import { milestonesReport } from '../controllers/reportController.js';

export const milestonesRouter = express.Router();

/**
 * @openapi
 * /milestones:
 *   get:
 *     summary: Get milestones list with filters (active users only)
 *     parameters:
 *       - in: query
 *         name: milestone_id
 *         schema:
 *           type: integer
 *         description: Specific milestone ID to filter
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: integer
 *         description: Filter by specific user ID (active users only)
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *         description: Number of working days range (uses created_after / updated_before)
 *     responses:
 *       200:
 *         description: List of milestones and users (active only)
 */
milestonesRouter.get('/', listMilestones);

/**
 * @openapi
 * /milestones/report:
 *   get:
 *     summary: Get time report (time_spent, time_estimate) per milestone
 *     parameters:
 *       - in: query
 *         name: milestone_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: integer
 *         description: When omitted, aggregates for all active users
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *         description: Number of working days range to consider
 *     responses:
 *       200:
 *         description: Array of report rows per milestone
 */
milestonesRouter.get('/report', milestonesReport);
// #### --> MRB <-- ### //
