import { baseUUrl, token, groupId, ALL_PROJECT_IDS, perPage } from './config.js';

/*
export function extractProjectFromLabels(labels) {
  if (!labels || !Array.isArray(labels)) {
    return "Unknown Project";
  }

  const projectLabel = labels.find((label) => label.startsWith("Project:"));

  if (projectLabel) {
    const projectName = projectLabel.replace("Project:", "").trim();
    console.log(`پروژه پیدا شد: ${projectName} از لیبل: ${projectLabel}`);
    return projectName;
  }

  console.log(`لیبل پروژه پیدا نشد در: ${JSON.stringify(labels)}`);
  return "Unknown Project";
}

export async function getProjectName(baseUUrl, projectId) {
  if (projectNameCache[projectId]) {
    return projectNameCache[projectId];
  }

  const response = await fetch(`${baseUUrl}/projects/${projectId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": token,
    },
  });

  if (!response.ok) {
    const fallbackName = `Project ${projectId}`;
    projectNameCache[projectId] = fallbackName;
    return fallbackName;
  }

  const data = await response.json();
  const projectName = data.name || `Project ${projectId}`;
  projectNameCache[projectId] = projectName;
  return projectName;
}*/

export async function getAllIssuesFromProject(baseUUrl, projectId, milestone) {
	let allIssues = [];
	let page = 1;

	while (true) {
		const response = await fetch(`${baseUUrl}/projects/${projectId}/issues?milestone=${encodeURIComponent(milestone)}&page=${page}&per_page=${perPage}`, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				'PRIVATE-TOKEN': token,
			},
		});

		if (!response.ok) {
			console.error(`خطا در گرفتن issues از پروژه ${projectId}, صفحه ${page}`);
			break;
		}

		const issues = await response.json();

		if (issues.length === 0) {
			break;
		}

		allIssues = allIssues.concat(issues);
		page++;

		if (issues.length < perPage) {
			break;
		}
	}

	return allIssues;
}

export async function getAllProjectIdsFromGroup(baseUUrl) {
	if (!groupId) return [];
	let page = 1;
	const ids = [];
	while (true) {
		const url = `${baseUUrl}/groups/${encodeURIComponent(groupId)}/projects?include_subgroups=true&archived=false&per_page=${perPage}&page=${page}`;
		const r = await fetch(url, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/json',
				'PRIVATE-TOKEN': token,
			},
		});
		if (!r.ok) break;
		const chunk = await r.json();
		if (!Array.isArray(chunk) || chunk.length === 0) break;
		for (const p of chunk) {
			const pid = p?.id ?? p?.project_id;
			if (pid) ids.push(pid);
		}
		const nextPageHeader = r.headers.get('x-next-page');
		if (!nextPageHeader || nextPageHeader === '0' || chunk.length < perPage) break;
		page = parseInt(nextPageHeader, 10) || page + 1;
	}
	return ids;
}

export async function resolveProjectIds(baseUUrl, projectIdParam) {
	if (projectIdParam === 'all') {
		const dynamicIds = await getAllProjectIdsFromGroup(baseUUrl);
		if (Array.isArray(dynamicIds) && dynamicIds.length > 0) return dynamicIds;
		if (Array.isArray(ALL_PROJECT_IDS) && ALL_PROJECT_IDS.length > 0) return ALL_PROJECT_IDS;
		throw new Error('Project list is empty. Set GITLAB_GROUP_ID or populate ALL_PROJECT_IDS.');
	}
	return [projectIdParam];
}

export function getProjectDisplayNameFromLabel(projectLabel) {
	if (typeof projectLabel !== 'string') return String(projectLabel || '');
	if (projectLabel.startsWith('Project:')) {
		return projectLabel.replace('Project:', '').trim();
	}
	return projectLabel;
}

export function getStatusDisplayNameFromLabel(projectLabel) {
	if (typeof projectLabel !== 'string') return String(projectLabel || '');
	if (projectLabel.startsWith('Status:')) {
		return projectLabel.replace('Status:', '').trim();
	}
	return projectLabel;
}

export async function fetchGitlabUsers() {
	const response = await fetch(`${baseUUrl}/users`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'PRIVATE-TOKEN': token,
		},
	});
	if (!response.ok) {
		throw new Error('Failed to fetch GitLab users');
	}
	const data = await response.json();
	return Array.isArray(data) ? data : [];
}

// --- Universal duration parser (e.g., '3d 4h 46m' to total seconds) ---
export function parseDurationString(str) {
	if (typeof str !== 'string') return 0;
	let seconds = 0;
	const unitRe = /(-?\d+)\s*(mo|w|d|h|m|s)(?=\D|$)/gi;
	let m;
	const H = 3600;
	const D = 8 * H;
	const W = 5 * D;
	const MO = 4 * W;
	while ((m = unitRe.exec(str)) !== null) {
		const val = parseInt(m[1], 10);
		const unit = m[2].toLowerCase();
		if (Number.isNaN(val)) continue;
		if (unit === 'mo') seconds += val * MO;
		else if (unit === 'w') seconds += val * W;
		else if (unit === 'd') seconds += val * D;
		else if (unit === 'h') seconds += val * H;
		else if (unit === 'm') seconds += val * 60;
		else if (unit === 's') seconds += val;
	}
	return seconds;
}
