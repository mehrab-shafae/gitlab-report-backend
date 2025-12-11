import { getProjectMilestones, getProjectId } from '../services/gitlabClient.js';
import { getActiveProjectMembers } from '../services/projectMembers.js';

export async function listMilestones(req, res) {
    try {
        const projectId = getProjectId();
        const { milestone_id: milestoneId } = req.query;

        const params = {};
        if (milestoneId) {
            params.iids = [Number(milestoneId)];
        }

        const [milestones, activeUsers] = await Promise.all([getProjectMilestones(projectId, params), getActiveProjectMembers(projectId)]);

        res.json({ milestones, users: activeUsers });
    } catch (error) {
        res.status(500).json({
            message: 'Failed to fetch milestones',
            error: error?.response?.data || error.message,
        });
    }
}
