// *** MRB *** //
// #### --> MRB <-- ### //
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const gitlabApi = axios.create({
  baseURL: process.env.GITLAB_BASE_URL,
  headers: {
    'Private-Token': process.env.GITLAB_TOKEN || '',
  },
  params: {},
});

export async function getProjectMilestones(projectId, params = {}) {
  const response = await gitlabApi.get(`/projects/${projectId}/milestones`, {
    params,
  });
  return response.data;
}

export async function getProjectIssues(projectId, params = {}) {
  const response = await gitlabApi.get(`/projects/${projectId}/issues`, {
    params,
  });
  return response.data;
}

export async function getIssueTimeStats(projectId, issueIid) {
  const response = await gitlabApi.get(`/projects/${projectId}/issues/${issueIid}`);
  return response.data?.time_stats || { time_estimate: 0, total_time_spent: 0 };
}

export async function getUsers(params = {}) {
  const response = await gitlabApi.get(`/users`, { params });
  return response.data;
}

export function getProjectId() {
  return process.env.GITLAB_PROJECT_ID;
}
// #### --> MRB <-- ### //
