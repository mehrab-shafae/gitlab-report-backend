import express from 'express';

export const reportsRouter = express.Router();

// لیست تمام پروژه‌هایی که باید issues از آن‌ها گرفته شود
const ALL_PROJECT_IDS = [91, 92, 93];

// کش برای ذخیره نام پروژه‌ها
const projectNameCache = {};

// تابع کمکی برای استخراج نام پروژه از لیبل‌ها
function extractProjectFromLabels(labels) {
	if (!labels || !Array.isArray(labels)) {
		return 'Unknown Project';
	}
	const projectLabel = labels.find(label => label.startsWith('Project:'));
	if (projectLabel) {
		const projectName = projectLabel.replace('Project:', '').trim();
		return projectName;
	}
	return 'Unknown Project';
}

// تابع کمکی برای گرفتن اسم پروژه از GitLab
async function getProjectName(baseUUrl, projectId) {
	if (projectNameCache[projectId]) {
		return projectNameCache[projectId];
	}
	const response = await fetch(`${baseUUrl}/projects/${projectId}`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'PRIVATE-TOKEN': process.env.GITLAB_TOKEN,
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
}

// تابع کمکی برای گرفتن همه issues از یک پروژه با pagination
async function getAllIssuesFromProject(baseUUrl, projectId, milestone) {
	let allIssues = [];
	let page = 1;
	const perPage = 100;
	while (true) {
		const response = await fetch(
			`${baseUUrl}/projects/${projectId}/issues?milestone=${encodeURIComponent(milestone)}&page=${page}&per_page=${perPage}`,
			{
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					'PRIVATE-TOKEN': process.env.GITLAB_TOKEN,
				},
			}
		);
		if (!response.ok) {
			break;
		}
		const issues = await response.json();
		if (issues.length === 0) break;
		allIssues = allIssues.concat(issues);
		page++;
		if (issues.length < perPage) break;
	}
	return allIssues;
}

const PROJECT_LABELS = {
	'Project: Arta': 'Arta Project',
	'Project: Fab': 'Fab Project',
	'Project: Forvest': 'Forvest Project',
	'Project: Akbari': 'Akbari Project',
	'Project: Buildideal': 'Buildideal Project',
};

// Time spends per user/project within a milestone
reportsRouter.get('/time-spends', async (req, res) => {
	try {
		const baseUUrl = process.env.GITLAB_BASE_URL;
		const { milestone, projectId, userId, workingDays } = req.query;
		const numWorkingDays = Number(workingDays);
		if (!milestone || !projectId) {
			return res.status(400).json({ message: 'milestone و projectId الزامی هستند' });
		}
		const perPage = 100;
		let page = 1;
		let issues = [];
		while (true) {
			const resp = await fetch(
				`${baseUUrl}/projects/${projectId}/issues?milestone=${encodeURIComponent(milestone)}&state=all&page=${page}&per_page=${perPage}`,
				{
					method: 'GET',
					headers: {
						'Content-Type': 'application/json',
						'PRIVATE-TOKEN': process.env.GITLAB_TOKEN,
					},
				}
			);
			if (!resp.ok) {
				return res.status(500).json({ message: 'مشکل در گرفتن دیتا از GitLab' });
			}
			const batch = await resp.json();
			if (!Array.isArray(batch) || batch.length === 0) break;
			issues = issues.concat(batch);
			if (batch.length < perPage) break;
			page += 1;
		}
		let usersIssues = [];
		if (userId && userId !== 'all') {
			const userIssues = issues.filter((issue) => {
				const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
				const inAssignees = assignees.some((a) => a && a.id == userId);
				const legacy = issue.assignee && issue.assignee.id == userId;
				return inAssignees || legacy;
			});
			let totalSpent = 0;
			let totalEstimate = 0;
			const projectsMap = {};
			for (const issue of userIssues) {
				const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
				const hasLegacy = !!issue.assignee;
				const assigneeCount = assignees.length > 0 ? assignees.length : (hasLegacy ? 1 : 0);
				const shareSpent = assigneeCount > 0 ? (issue.time_stats?.total_time_spent || 0) / assigneeCount : 0;
				const shareEstimate = assigneeCount > 0 ? (issue.time_stats?.time_estimate || 0) / assigneeCount : 0;
				totalSpent += shareSpent;
				totalEstimate += shareEstimate;
				const projectLabel = issue.labels.find((l) => l.startsWith('Project: '));
				if (!projectLabel) continue;
				if (!projectsMap[projectLabel]) {
					projectsMap[projectLabel] = {
						projectLabel,
						projectName: PROJECT_LABELS[projectLabel] || projectLabel,
						totalSpent: 0,
						totalEstimate: 0,
						percentWork: 0,
					};
				}
				projectsMap[projectLabel].totalSpent += shareSpent;
				projectsMap[projectLabel].totalEstimate += shareEstimate;
			}
			Object.values(projectsMap).forEach((proj) => {
				proj.percentWork = totalSpent > 0 ? ((proj.totalSpent / totalSpent) * 100).toFixed(2) : 0;
				proj.performance =
					numWorkingDays && numWorkingDays > 0
						? ((proj.totalSpent / (numWorkingDays * 8 * 3600)) * 100).toFixed(2)
						: 0;
			});
			let userInfo = {};
			for (const issue of userIssues) {
				const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
				const found = assignees.find((a) => a && a.id == userId);
				if (found) { userInfo = found; break; }
				if (issue.assignee && issue.assignee.id == userId) { userInfo = issue.assignee; break; }
			}
			usersIssues.push({
				userId,
				username: userInfo.username || '',
				name: userInfo.name || '',
				avatar_url: userInfo.avatar_url || '',
				totalSpent,
				totalEstimate,
				projects: Object.values(projectsMap),
			});
		} else {
			const usersMap = {};
			for (const issue of issues) {
				const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
				const hasLegacy = !!issue.assignee;
				const recipients = assignees.length > 0 ? assignees : (hasLegacy ? [issue.assignee] : []);
				if (recipients.length === 0) continue;
				const shareSpent = (issue.time_stats?.total_time_spent || 0) / recipients.length;
				const shareEstimate = (issue.time_stats?.time_estimate || 0) / recipients.length;
				const projectLabel = issue.labels.find((l) => l.startsWith('Project: '));
				for (const person of recipients) {
					if (!person || !person.id) continue;
					const uid = person.id;
					if (!usersMap[uid]) {
						usersMap[uid] = {
							userId: uid,
							username: person.username,
							name: person.name,
							avatar_url: person.avatar_url,
							totalSpent: 0,
							totalEstimate: 0,
							projects: {},
						};
					}
					usersMap[uid].totalSpent += shareSpent;
					usersMap[uid].totalEstimate += shareEstimate;
					if (!projectLabel) continue;
					if (!usersMap[uid].projects[projectLabel]) {
						usersMap[uid].projects[projectLabel] = {
							projectLabel,
							projectName: PROJECT_LABELS[projectLabel] || projectLabel,
							totalSpent: 0,
							totalEstimate: 0,
							percentWork: 0,
							issueIds: [],
						};
					}
					usersMap[uid].projects[projectLabel].totalSpent += shareSpent;
					usersMap[uid].projects[projectLabel].totalEstimate += shareEstimate;
					if (issue.iid) {
						usersMap[uid].projects[projectLabel].issueIds.push(issue.iid);
					}
				}
			}
			Object.values(usersMap).forEach((user) => {
				Object.values(user.projects).forEach((proj) => {
					const toHM = (sec) => {
						const s = Math.round(Number(sec) || 0);
						const h = Math.floor(s / 3600);
						const m = Math.floor((s % 3600) / 60);
						return `${h}h ${m}m`;
					};
					const ids = Array.isArray(proj.issueIds) ? proj.issueIds : [];
					const idsPreview = ids.slice(0, 5).join(',');
					const idsSuffix = ids.length > 5 ? `(+${ids.length - 5} more)` : '';
					console.log(`[time-spends] user="${user.name}" | project="${proj.projectName}" | issues=[${idsPreview}] ${idsSuffix}`);
					proj.percentWork = user.totalSpent > 0 ? ((proj.totalSpent / user.totalSpent) * 100).toFixed(2) : 0;
					proj.performance =
						numWorkingDays && numWorkingDays > 0
							? ((proj.totalSpent / (numWorkingDays * 8 * 3600)) * 100).toFixed(2)
							: 0;
				});
				user.projects = Object.values(user.projects);
			});
			usersIssues = Object.values(usersMap);
		}
		res.json(usersIssues);
	} catch (error) {
		res.status(500).json({ message: 'خطا در پردازش دیتا', error: error?.message || String(error) });
	}
});

// Milestone daily spends per user
reportsRouter.get('/milestone-daily-spends', async (req, res) => {
	try {
		const baseUUrl = process.env.GITLAB_BASE_URL;
		const { projectId = 'all', milestone } = req.query;
		if (!milestone) {
			return res.status(400).json({ message: 'milestone الزامی است' });
		}
		const projectIds = projectId === 'all' ? ALL_PROJECT_IDS : [projectId];
		const usersMap = {};
		const parseSpentFromNote = (body) => {
			if (typeof body !== 'string') return 0;
			const lowered = body.toLowerCase();
			const isAdd = lowered.includes('added') && lowered.includes('time spent');
			const isSub = lowered.includes('subtracted') && lowered.includes('time spent');
			if (!isAdd && !isSub) return 0;
			const hourMatch = lowered.match(/(\d+)\s*h/);
			const minMatch = lowered.match(/(\d+)\s*m/);
			const secMatch = lowered.match(/(\d+)\s*s/);
			let seconds = 0;
			if (hourMatch) seconds += parseInt(hourMatch[1], 10) * 3600;
			if (minMatch) seconds += parseInt(minMatch[1], 10) * 60;
			if (secMatch) seconds += parseInt(secMatch[1], 10);
			return isSub ? -seconds : seconds;
		};
		for (const pid of projectIds) {
			const issues = await getAllIssuesFromProject(baseUUrl, pid, milestone);
			for (const issue of issues) {
				const issueIid = issue.iid;
				if (!issueIid) continue;
				const notesResp = await fetch(
					`${baseUUrl}/projects/${pid}/issues/${issueIid}/notes?system=true&per_page=100`,
					{
						method: 'GET',
						headers: {
							'Content-Type': 'application/json',
							'PRIVATE-TOKEN': process.env.GITLAB_TOKEN,
						},
					}
				);
				if (!notesResp.ok) continue;
				const notes = await notesResp.json();
				for (const note of notes) {
					if (!note?.body || !note?.created_at || !note?.author?.id) continue;
					const deltaSeconds = parseSpentFromNote(note.body);
					if (deltaSeconds === 0) continue;
					const dateKey = new Date(note.created_at).toISOString().slice(0, 10);
					const author = note.author;
					const uid = author.id;
					if (!usersMap[uid]) {
						usersMap[uid] = { userId: uid, username: author.username || '', name: author.name || '', avatar_url: author.avatar_url || '', byDate: {} };
					}
					usersMap[uid].byDate[dateKey] = (usersMap[uid].byDate[dateKey] || 0) + deltaSeconds;
				}
			}
		}
		const monthMatch = String(milestone).match(/(\d{4})-(\d{2})/);
		const targetYear = monthMatch ? parseInt(monthMatch[1], 10) : new Date().getUTCFullYear();
		const targetMonthNum = monthMatch ? parseInt(monthMatch[2], 10) : (new Date().getUTCMonth() + 1);
		const monthIndex = targetMonthNum - 1;
		const daysInMonth = new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate();
		const monthDates = [];
		for (let day = 1; day <= daysInMonth; day++) {
			const d = new Date(Date.UTC(targetYear, monthIndex, day)).toISOString().slice(0, 10);
			monthDates.push(d);
		}
		const results = Object.values(usersMap).map((u) => ({
			userId: u.userId,
			username: u.username,
			name: u.name,
			avatar_url: u.avatar_url,
			spend: monthDates.map((d) => ({ date: d, spent: u.byDate[d] || 0 })),
		}));
		res.json(results);
	} catch (error) {
		res.status(500).json({ message: 'خطا در تولید گزارش روزانه مایل‌استون', error: error?.message || String(error) });
	}
});

// Labels report
reportsRouter.get('/labels-report', async (req, res) => {
	try {
		const baseUUrl = process.env.GITLAB_BASE_URL;
		const { milestone, labels, userId, projectId } = req.query;
		if (!labels) {
			return res.status(400).json({ message: 'حداقل یک لیبل الزامی است' });
		}
		const labelList = labels.split(',').map((l) => l.trim());
		const projectIds = projectId === 'all' ? [91, 92, 93, 94, 95] : [projectId];
		let allIssues = [];
		for (const pid of projectIds) {
			const params = new URLSearchParams();
			if (milestone) params.append('milestone', milestone);
			const response = await fetch(`${baseUUrl}/projects/${pid}/issues?${params.toString()}`, {
				method: 'GET',
				headers: { 'Content-Type': 'application/json', 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN },
			});
			if (!response.ok) {
				return res.status(500).json({ message: 'مشکل در گرفتن دیتا از GitLab' });
			}
			const issues = await response.json();
			allIssues.push(...issues);
		}
		if (userId && userId !== 'all') {
			allIssues = allIssues.filter((issue) => {
				const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
				const inAssignees = assignees.some((a) => a && a.id == userId);
				const legacy = issue.assignee && issue.assignee.id == userId;
				return inAssignees || legacy;
			});
		}
		const results = [];
		for (const label of labelList) {
			const filteredIssues = allIssues.filter((issue) => issue.labels && issue.labels.includes(label));
			const totalSpent = filteredIssues.reduce((sum, issue) => sum + (issue.time_stats?.total_time_spent || 0), 0);
			const issueCount = filteredIssues.length;
			const uniqueUsers = new Set(
				filteredIssues.flatMap((issue) => {
					const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
					const legacyAssignee = issue.assignee ? [issue.assignee] : [];
					return [...assignees, ...legacyAssignee].map((a) => a?.id).filter(Boolean);
				})
			).size;
			const avgSpentPerIssue = issueCount > 0 ? (totalSpent / issueCount).toFixed(2) : 0;
			const usersMap = {};
			for (const issue of filteredIssues) {
				const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
				const hasLegacy = !!issue.assignee;
				const recipients = assignees.length > 0 ? assignees : (hasLegacy ? [issue.assignee] : []);
				for (const person of recipients) {
					if (!person || !person.id) continue;
					const uid = person.id;
					if (!usersMap[uid]) {
						usersMap[uid] = { userId: uid, username: person.username, name: person.name, avatar_url: person.avatar_url, issueCount: 0, spentTime: 0, percentWork: 0 };
					}
					usersMap[uid].issueCount += 1;
					usersMap[uid].spentTime += issue.time_stats?.total_time_spent || 0;
				}
			}
			Object.values(usersMap).forEach((user) => {
				user.percentWork = totalSpent > 0 ? ((user.spentTime / totalSpent) * 100).toFixed(2) : 0;
			});
			results.push({ label, totalSpent, issueCount, uniqueUsers, avgSpentPerIssue, users: Object.values(usersMap) });
		}
		res.json(results);
	} catch (error) {
		res.status(500).json({ message: 'خطا در پردازش دیتا', error: error?.message || String(error) });
	}
});

// Daily report by parsing system notes
reportsRouter.get('/daily-report', async (req, res) => {
	try {
		const baseUUrl = process.env.GITLAB_BASE_URL;
		const { projectId = 'all', date } = req.query;
		const targetDate = (date || new Date().toISOString().slice(0, 10));
		const projectIds = projectId === 'all' ? ALL_PROJECT_IDS : [projectId];
		const parseSpentFromNote = (body) => {
			if (typeof body !== 'string') return 0;
			const lowered = body.toLowerCase();
			const isAdd = lowered.includes('added') && lowered.includes('time spent');
			const isSub = lowered.includes('subtracted') && lowered.includes('time spent');
			if (!isAdd && !isSub) return 0;
			const hourMatch = lowered.match(/(\d+)\s*h/);
			const minMatch = lowered.match(/(\d+)\s*m/);
			const secMatch = lowered.match(/(\d+)\s*s/);
			let seconds = 0;
			if (hourMatch) seconds += parseInt(hourMatch[1], 10) * 3600;
			if (minMatch) seconds += parseInt(minMatch[1], 10) * 60;
			if (secMatch) seconds += parseInt(secMatch[1], 10);
			return isSub ? -seconds : seconds;
		};
		const usersMap = {};
		for (const pid of projectIds) {
			const issues = await getAllIssuesFromProject(baseUUrl, pid, '');
			for (const issue of issues) {
				const issueIid = issue.iid;
				if (!issueIid) continue;
				const notesResp = await fetch(`${baseUUrl}/projects/${pid}/issues/${issueIid}/notes?system=true&per_page=100`, {
					method: 'GET',
					headers: { 'Content-Type': 'application/json', 'PRIVATE-TOKEN': process.env.GITLAB_TOKEN },
				});
				if (!notesResp.ok) continue;
				const notes = await notesResp.json();
				for (const note of notes) {
					const createdAt = note.created_at;
					if (!createdAt || !note.body) continue;
					const noteDate = new Date(createdAt).toISOString().slice(0, 10);
					if (noteDate !== targetDate) continue;
					const deltaSeconds = parseSpentFromNote(note.body);
					if (deltaSeconds === 0) continue;
					const author = note.author || {};
					const uid = author.id;
					if (!uid) continue;
					if (!usersMap[uid]) {
						usersMap[uid] = { userId: uid, username: author.username || '', name: author.name || '', avatar_url: author.avatar_url || '', dailySpent: 0 };
					}
					usersMap[uid].dailySpent += deltaSeconds;
				}
			}
		}
		const results = Object.values(usersMap).map(u => ({ userId: u.userId, username: u.username, name: u.name, avatar_url: u.avatar_url, dailySpent: u.dailySpent }));
		res.json(results);
	} catch (error) {
		res.status(500).json({ message: 'خطا در تولید گزارش روزانه', error: error?.message || String(error) });
	}
});


