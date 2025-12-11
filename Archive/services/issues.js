import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const client = axios.create({
    baseURL: process.env.GITLAB_BASE_URL,
    headers: {
        'Private-Token': process.env.GITLAB_TOKEN || '',
    },
});

export async function fetchIssuesPaginated(projectId, params = {}) {
    const perPage = Math.min(Number(params.per_page) || 100, 100);
    let page = 1;
    let all = [];
    while (true) {
        const response = await client.get(`/projects/${projectId}/issues`, {
            params: { ...params, per_page: perPage, page },
        });
        const items = response.data || [];
        all = all.concat(items);
        if (items.length < perPage) {
            break;
        }
        page += 1;
    }
    return all;
}
