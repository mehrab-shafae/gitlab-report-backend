'use strict';

export default function (allIssues, usersMap, isInRange, toKey, userIds) {
	for (const issue of allIssues) {
		const updatedKey = issue.updated_at ? toKey(issue.updated_at) : null;
		if (!updatedKey || !isInRange(updatedKey)) continue;
		const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
		const legacy = issue.assignee ? [issue.assignee] : [];
		const recipients = assignees.length > 0 ? assignees : legacy;
		for (const person of recipients) {
			if (!person || !person.id) continue;
			const uid = Number(person.id);
			if (!userIds.includes(uid)) continue;
			if (!usersMap[uid]) {
				usersMap[uid] = {
					userId: uid,
					username: person.username,
					name: person.name,
					avatar_url: person.avatar_url,
					totalSpent: 0,
					issues: {},
					labels: new Set(),
				};
			}
			if (!usersMap[uid].issues[issue.iid]) {
				usersMap[uid].issues[issue.iid] = {
					iid: issue.iid,
					title: issue.title,
					state: issue.state,
					labels: issue.labels,
					time_stats: issue.time_stats,
					milestone: issue.milestone,
					updated_at: issue.updated_at,
					assignedIds: Array.isArray(recipients) ? recipients.filter(p => p && p.id).map(p => Number(p.id)) : [],
					spentInRange: 0,
					commentsInRange: 0,
				};
				if (Array.isArray(issue.labels)) {
					issue.labels.forEach(l => usersMap[uid].labels.add(l));
				}
			}
		}
	}
	// ========================================================================================
	for (const issue of allIssues) {
		const createdKey = issue.created_at ? toKey(issue.created_at) : null;
		if (!createdKey || !isInRange(createdKey)) continue;
		const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
		const legacy = issue.assignee ? [issue.assignee] : [];
		const recipients = assignees.length > 0 ? assignees : legacy;
		for (const person of recipients) {
			if (!person || !person.id) continue;
			const uid = Number(person.id);
			if (!userIds.includes(uid)) continue;
			if (!usersMap[uid]) {
				usersMap[uid] = {
					userId: uid,
					username: person.username,
					name: person.name,
					avatar_url: person.avatar_url,
					totalSpent: 0,
					issues: {},
					labels: new Set(),
				};
			}
			if (!usersMap[uid].issues[issue.iid]) {
				usersMap[uid].issues[issue.iid] = {
					iid: issue.iid,
					title: issue.title,
					state: issue.state,
					labels: issue.labels,
					time_stats: issue.time_stats,
					milestone: issue.milestone,
					updated_at: issue.updated_at,
					assignedIds: Array.isArray(recipients) ? recipients.filter(p => p && p.id).map(p => Number(p.id)) : [],
					spentInRange: 0,
					commentsInRange: 0,
				};
				if (Array.isArray(issue.labels)) {
					issue.labels.forEach(l => usersMap[uid].labels.add(l));
				}
			}
		}
	}
	// ========================================================================================
	for (const u of Object.values(usersMap)) {
		u.emptyIssues = [];
	}
	// ========================================================================================
	for (const issue of allIssues) {
		const isEmpty = !issue.time_stats || (!Number(issue.time_stats.time_estimate) && !Number(issue.time_stats.total_time_spent)) || (Number(issue.time_stats.time_estimate) === 0 && Number(issue.time_stats.total_time_spent) === 0);
		if (!isEmpty) continue;
		const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
		const legacy = issue.assignee ? [issue.assignee] : [];
		const recipients = assignees.length > 0 ? assignees : legacy;
		for (const person of recipients) {
			if (!person || !person.id) continue;
			const uid = Number(person.id);
			if (!usersMap[uid]) continue;
			let u = usersMap[uid];
			u.emptyIssues.push({
				iid: issue.iid,
				title: issue.title,
				description: issue.description,
				state: issue.state,
				labels: issue.labels,
				time_stats: issue.time_stats,
				milestone: issue.milestone,
				created_at: issue.created_at,
				updated_at: issue.updated_at,
				assignees: recipients.map(a => (a && a.id ? { id: a.id, username: a.username, name: a.name, avatar_url: a.avatar_url } : null)).filter(Boolean),
				isEmpty: true,
			});
		}
	}
}
