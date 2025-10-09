import dayjs from 'dayjs';
import { getProjectId, getProjectMilestones } from '../services/gitlabClient.js';
import { fetchIssuesPaginated } from '../services/issues.js';
import { getActiveProjectMembers } from '../services/projectMembers.js';
import { subtractWorkingDays } from '../utils/dates.js';

export async function milestonesReport(req, res) {
  try {
    const projectId = getProjectId();
    const { user_id: userIdParam, milestone_id: milestoneIdParam, days: daysParam } = req.query;
    const userId = userIdParam ? Number(userIdParam) : undefined;
    const milestoneIidFilter = milestoneIdParam ? Number(milestoneIdParam) : undefined;
    const days = daysParam ? Number(daysParam) : undefined;

    const nowIso = dayjs().toISOString();
    const startIso = days ? subtractWorkingDays(dayjs(), days).startOf('day').toISOString() : undefined;

    const [milestones, activeUsers] = await Promise.all([getProjectMilestones(projectId, milestoneIidFilter ? { iids: [milestoneIidFilter] } : {}), getActiveProjectMembers(projectId)]);

    const activeUserIds = new Set(activeUsers.map(u => u.id));
    if (userId && !activeUserIds.has(userId)) {
      return res.status(400).json({ message: 'User is not active in this project' });
    }

    const results = [];
    for (const milestone of milestones) {
      const issues = await fetchIssuesPaginated(projectId, {
        milestone: milestone.title,
        per_page: 100,
        // date filters
        created_after: startIso,
        updated_before: days ? nowIso : undefined,
      });

      let filteredIssues = issues;
      if (userId) {
        filteredIssues = issues.filter(issue => {
          const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
          const inAssignees = assignees.some(a => a && a.id === userId);
          const legacy = issue.assignee && issue.assignee.id === userId;
          return inAssignees || legacy;
        });
      }

      let timeEstimate = 0;
      let totalTimeSpent = 0;
      for (const issue of filteredIssues) {
        timeEstimate += issue?.time_stats?.time_estimate || 0;
        totalTimeSpent += issue?.time_stats?.total_time_spent || 0;
      }

      results.push({
        milestone_id: milestone.id,
        milestone_iid: milestone.iid,
        title: milestone.title,
        issues_count: filteredIssues.length,
        time_estimate: timeEstimate,
        total_time_spent: totalTimeSpent,
      });
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: 'Failed to build report',
      error: error?.response?.data || error.message,
    });
  }
}
