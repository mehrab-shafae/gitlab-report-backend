import auth from '../middleware/auth.js';
import milestones from './Main/milestones.js';
import Users from './Main/Users.js';
import labels from './Main/labels.js';
import time_spents from './Main/time_spends.js';
import milestone_daily_spends from './Main/milestone_daily_spends.js';
import labels_report from './Main/labels_report.js';
import daily_report from './Main/daily_report.js';
import daily from './Main/daily.js';
import activity_range from './Main/activity_range.js';

export default function (app) {
	app.use(asyncHandler(auth));

	app.get('/milestones', asyncHandler(milestones));

	app.get('/Users', asyncHandler(Users));

	app.get('/labels', asyncHandler(labels));

	app.get('/time-spends', asyncHandler(time_spents));

	app.get('/milestone-daily-spends', asyncHandler(milestone_daily_spends));

	app.get('/labels-report', asyncHandler(labels_report));

	app.get('/daily-report', asyncHandler(daily_report));

	app.get('/daily', asyncHandler(daily));

	app.get('/activity-range', asyncHandler(activity_range));
}
