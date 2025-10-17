'use strict';

import { baseUUrl, token, projectId } from '../../config.js';
import { parseDurationString } from '../../utils.js';
import { weights, attribution } from './ActivityRange/config.js';
import excel from './ActivityRange/excel.js';
import IssueFunc from './ActivityRange/issue.js';

export default async (req, res) => {
	try {
		const { users, from, to } = req.query;

		if (!users || !from || !to) {
			return res.status(400).json({ message: 'پارامترهای users, from, to الزامی هستند' });
		}

		if (!req.auth.isAdmin && req.auth.gitlabUserId) {
			const currentUserId = req.auth.gitlabUserId;
			const requestedUserIds = String(users)
				.split(',')
				.map(s => s.trim())
				.filter(Boolean)
				.map(s => Number(s))
				.filter(n => !Number.isNaN(n));

			if (requestedUserIds.length > 0 && !requestedUserIds.includes(currentUserId)) {
				return res.status(403).json({ message: 'شما فقط می‌توانید داده‌های خودتان را مشاهده کنید' });
			}

			if (requestedUserIds.length === 0 || !requestedUserIds.includes(currentUserId)) {
				req.query.users = currentUserId.toString();
			}
		}

		const userIds = String(users)
			.split(',')
			.map(s => s.trim())
			.filter(Boolean)
			.map(s => Number(s))
			.filter(n => !Number.isNaN(n));
		const userIdsSet = new Set(userIds);
		if (userIds.length === 0) {
			return res.status(400).json({ message: 'حداقل یک userId معتبر لازم است' });
		}

		const fromDate = new Date(from);
		const toDate = new Date(to);
		if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
			return res.status(400).json({ message: 'فرمت تاریخ از/تا نامعتبر است' });
		}
		const pad2 = n => String(n).padStart(2, '0');
		let tzOffsetMinutes = Number(0);
		const toKey = d => {
			const base = d instanceof Date ? d : new Date(d);
			const adjMs = base.getTime() + (Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0) * 60000;
			const adj = new Date(adjMs);
			return `${adj.getUTCFullYear()}-${pad2(adj.getUTCMonth() + 1)}-${pad2(adj.getUTCDate())}`;
		};
		const startKey = toKey(fromDate);
		const endKey = toKey(toDate);
		const isInRange = isoDate => isoDate >= startKey && isoDate <= endKey;

		const enumerateWorkingDates = () => {
			const out = [];
			const start = new Date(fromDate);
			const end = new Date(toDate);
			for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
				const key = toKey(d);
				out.push(key); // هر روز بازه
			}
			return out;
		};
		const workingDateKeys = enumerateWorkingDates();

		// issues

		const issueChunks = await IssueFunc();

    	const usersMap = {};

		for (const chunk of issueChunks) {
			await Promise.allSettled(
				chunk.map(async issue => {
					if (!issue?.iid) return;
					const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
					const legacy = issue.assignee ? [issue.assignee] : [];
					const recipients = assignees.length > 0 ? assignees : legacy;

					const targetAssignees = recipients.filter(p => p && userIdsSet.has(Number(p.id)));
					if (targetAssignees.length === 0) return;

					try {
						console.log(
							'[activity-range][issue] iid=',
							issue.iid,
							'assignees=',
							recipients
								.map(p => p && p.id)
								.filter(Boolean)
								.join(',')
						);
					} catch (e) {}

					// paginate system notes
					const fetchAllNotes = async systemFlag => {
						let page = 1;
						const out = [];
						while (true) {
							const url = `${baseUUrl}/projects/${projectId}/issues/${issue.iid}/notes?${systemFlag ? 'system=true&' : ''}per_page=100&page=${page}`;
							const r = await fetch(url, {
								method: 'GET',
								headers: {
									'Content-Type': 'application/json',
									'PRIVATE-TOKEN': token,
									Connection: 'keep-alive',
								},
							});
							if (!r.ok) break;
							const chunk = await r.json();
							if (!Array.isArray(chunk) || chunk.length === 0) break;
							out.push(...chunk);
							const next = r.headers.get('x-next-page');
							if (!next || next === '0' || chunk.length < 100) break;
							page = parseInt(next, 10) || page + 1;
						}
						return out;
					};

					const [sysNotes, userNotes] = await Promise.all([fetchAllNotes(true), fetchAllNotes(false)]);

					if (Array.isArray(sysNotes)) {
						const notes = [...sysNotes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
						try {
							console.log('[activity-range][notes][system] iid=', issue.iid, 'count=', Array.isArray(notes) ? notes.length : 0);
						} catch (e) {}
						for (const note of notes) {
							if (!note?.body || !note?.created_at || !note?.author?.id) continue;
							const authorId = Number(note.author.id);
							let noteKey = toKey(note.created_at);
							let targetKey = noteKey;
							const body = String(note.body).toLowerCase();

							// تلاش برای استخراج تاریخ صریح از متن
							// 1) ISO 8601: YYYY-MM-DD (با یا بدون from/on/at)
							const mIso = body.match(/(?:\b(?:from|on|at)\s+)?(\d{4}-\d{2}-\d{2})\b/);
							// 2) Slash: YYYY/MM/DD
							const mSlash = !mIso && body.match(/(?:\b(?:from|on|at)\s+)?(\d{4}\/\d{2}\/\d{2})\b/);
							// 3) Month name: Oct 6, 2025
							const mMon = !mIso && !mSlash && body.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2}),\s*(\d{4})\b/i);
							let normalized = null;
							if (mIso) {
								normalized = mIso[1];
							} else if (mSlash) {
								normalized = mSlash[1].replace(/\//g, '-');
							} else if (mMon) {
								const mon = mMon[1].toLowerCase();
								const day = String(mMon[2]).padStart(2, '0');
								const year = mMon[3];
								const monMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12' };
								const mm = monMap[mon];
								if (mm) normalized = `${year}-${mm}-${day}`;
							}
							if (normalized) {
								targetKey = normalized;
							}
							if (!isInRange(targetKey)) continue;
							// ثبت log برای دیباگ
							try {
								console.log(`[activity-range][log][spent] issue=${issue.iid} author=${note.author.id} body=... dateKey=${targetKey}`);
							} catch (e) {}

							// --- special-case: remove_time_spent (no amount, clears all spent) ---
							if (/\bremoved\s+(?:all\s+)?(?:time\s+spent|spent\s+time)\b/i.test(body)) {
								// Apply remove-all regardless of note date; it zeroes out all tracked spent for this issue in range
								const assigneesForShare = recipients.filter(p => p && userIdsSet.has(Number(p.id)));
								try {
									console.log('[activity-range][parse][remove_time_spent][pre-author-check]', {
										iid: issue.iid,
										at: note.created_at,
										author: authorId,
										shareCount: assigneesForShare.length,
									});
								} catch (e) {}
								for (const person of assigneesForShare) {
									const uidShare = Number(person.id);
									const uRec = usersMap[uidShare];
									if (!uRec) continue;
									const issRec = uRec.issues && uRec.issues[issue.iid];
									if (!issRec) continue;
									const currentTotal = Number(issRec.spentInRange) || 0;
									if (currentTotal === 0) continue;
									// subtract per-day amounts tracked on the issue
									const perDay = issRec.byDate || {};
									for (const [dkey, val] of Object.entries(perDay)) {
										if (typeof val === 'number' && val !== 0) {
											uRec.byDate[dkey] = (uRec.byDate[dkey] || 0) - val;
										}
									}
									uRec.totalSpent -= currentTotal;
									issRec.spentInRange = 0;
									issRec.byDate = {};
									try {
										console.log('[activity-range][apply][remove_time_spent][per-issue-clear]', {
											userId: uidShare,
											iid: issue.iid,
											delta: -currentTotal,
											totalSpent: uRec.totalSpent,
										});
									} catch (e) {}
								}
								continue;
							}

							// Do not require author to be selected or an assignee; attribution logic below will handle distribution

							const delMatch = body.match(/(?:deleted|removed)\s+(.+?)\s+of\s+(?:spent\s+time|time\s+spent)\s+(?:from|on|at)\s+(\d{4}-\d{2}-\d{2})/i);
							if (delMatch) {
								const duration = delMatch[1];
								const fromDateKey = delMatch[2];

								if (!isInRange(fromDateKey)) continue;
								let seconds = 0;
								seconds = parseDurationString(duration);
								seconds = Math.abs(seconds);
								if (seconds === 0) continue;

								// Attribution strategy: author-first vs shared
								// Determine attribution targets
								let assigneesForShare = recipients;
								let baseCount = assigneesForShare.length || 1;
								let shareSeconds = seconds / baseCount;
								if (attribution === 'author') {
									assigneesForShare = [{ id: authorId, username: note.author.username, name: note.author.name, avatar_url: note.author.avatar_url }];
									baseCount = 1;
									shareSeconds = seconds;
								}
								try {
									console.log('[activity-range][parse][delete]', {
										iid: issue.iid,
										at: note.created_at,
										author: authorId,
										duration,
										seconds,
										shareCount,
										shareSeconds,
										forDate: fromDateKey,
									});
								} catch (e) {}
								for (const person of assigneesForShare) {
									const uidShare = Number(person.id);
									if (!userIdsSet.has(uidShare)) continue;
									if (!usersMap[uidShare]) {
										usersMap[uidShare] = {
											userId: uidShare,
											username: person.username || note.author.username || '',
											name: person.name || note.author.name || '',
											avatar_url: person.avatar_url || note.author.avatar_url || '',
											totalSpent: 0,
											issues: {},
											labels: new Set(),
											byDate: {},
										};
									}
									if (!usersMap[uidShare].issues[issue.iid]) {
										usersMap[uidShare].issues[issue.iid] = {
											iid: issue.iid,
											title: issue.title,
											state: issue.state,
											labels: issue.labels,
											time_stats: issue.time_stats,
											milestone: issue.milestone,
											created_at: issue.created_at,
											updated_at: issue.updated_at,
											assignedIds: Array.isArray(recipients) ? recipients.filter(p => p && p.id).map(p => Number(p.id)) : [],
											spentInRange: 0,
											estimateInRange: 0,
											commentsInRange: 0,
											byDate: {},
											estimateByDate: {},
											quality: {
												hasTitle: Boolean(issue.title && String(issue.title).trim().length > 0),
												hasDescription: Boolean(issue.description && String(issue.description).trim().length > 0),
												labelsCount: Array.isArray(issue.labels) ? issue.labels.length : 0,
												hasStatusLabel: Array.isArray(issue.labels) ? issue.labels.some(l => /status/i.test(String(l))) : false,
												estimateIsZero: !(issue.time_stats && Number(issue.time_stats.time_estimate) > 0),
												spentIsZero: !(issue.time_stats && Number(issue.time_stats.total_time_spent) > 0),
												spentEqualsEstimate: Boolean(issue.time_stats && Number(issue.time_stats.time_estimate) > 0 && Number(issue.time_stats.total_time_spent) === Number(issue.time_stats.time_estimate)),
												descriptionEditsInRange: 0,
												largeOneOffSpends: [],
											},
											estimateCurrent: 0,
										};
										if (Array.isArray(issue.labels)) {
											issue.labels.forEach(l => usersMap[uidShare].labels.add(l));
										}
									}
									const currentIssueDay = Number(usersMap[uidShare].issues[issue.iid].byDate[fromDateKey] || 0);
									const applied = Math.min(currentIssueDay, Math.abs(shareSeconds));
									if (applied <= 0) continue;
									const appliedSigned = -applied;
									usersMap[uidShare].totalSpent += appliedSigned;
									usersMap[uidShare].issues[issue.iid].spentInRange = Math.max(0, (usersMap[uidShare].issues[issue.iid].spentInRange || 0) + appliedSigned);
									usersMap[uidShare].byDate[fromDateKey] = Math.max(0, (usersMap[uidShare].byDate[fromDateKey] || 0) + appliedSigned);
									usersMap[uidShare].issues[issue.iid].byDate[fromDateKey] = Math.max(0, currentIssueDay + appliedSigned);
									try {
										console.log('[activity-range][apply][delete]', {
											userId: uidShare,
											iid: issue.iid,
											forDate: fromDateKey,
											delta: appliedSigned,
											totalSpent: usersMap[uidShare].totalSpent,
										});
									} catch (e) {}
								}
								continue;
							}

							if (!isInRange(noteKey)) continue;

							const isAdd = body.includes('added') && (body.includes('time spent') || body.includes('spent time'));
							const isSub = (body.includes('subtracted') || body.includes('removed') || body.includes('deleted')) && (body.includes('time spent') || body.includes('spent time'));
							if (!isAdd && !isSub) continue;
							let seconds = 0;

							const addSubMatchA = body.match(/(?:added|subtracted|removed|deleted)\s+(.+?)\s+of\s+(?:time\s+spent|spent\s+time)/i);
							const addSubMatchB = body.match(/(?:added|subtracted|removed|deleted)\s+(?:time\s+spent|spent\s+time)\s+of\s+(.+?)(?:\.|$)/i);
							const parseSource = addSubMatchA ? addSubMatchA[1] : addSubMatchB ? addSubMatchB[1] : body;

							seconds = parseDurationString(parseSource);
							seconds = Math.abs(seconds);
							if (seconds === 0) continue;

							// Attribution strategy: author-first vs shared
							// Determine attribution targets and share by total assignees count to avoid inflating shares
							let assigneesForShare = recipients;
							let baseCount = assigneesForShare.length || 1;
							const delta = isSub ? -seconds : seconds;
							let shareSeconds = delta / baseCount;
							if (attribution === 'author') {
								assigneesForShare = [{ id: authorId, username: note.author.username, name: note.author.name, avatar_url: note.author.avatar_url }];
								baseCount = 1;
								shareSeconds = delta;
							}
							try {
								console.log('[activity-range][parse][change]', {
									iid: issue.iid,
									at: note.created_at,
									author: authorId,
									isAdd,
									isSub,
									seconds,
									delta,
									shareCount,
									shareSeconds,
									dateKey: noteKey,
								});
							} catch (e) {}
							for (const person of assigneesForShare) {
								const uidShare = Number(person.id);
								if (!userIdsSet.has(uidShare)) continue;
								if (!usersMap[uidShare]) {
									usersMap[uidShare] = {
										userId: uidShare,
										username: person.username || note.author.username || '',
										name: person.name || note.author.name || '',
										avatar_url: person.avatar_url || note.author.avatar_url || '',
										totalSpent: 0,
										issues: {},
										labels: new Set(),
										byDate: {},
										spendAddLog: [],
									};
								}
								if (!usersMap[uidShare].issues[issue.iid]) {
									usersMap[uidShare].issues[issue.iid] = {
										iid: issue.iid,
										title: issue.title,
										state: issue.state,
										labels: issue.labels,
										time_stats: issue.time_stats,
										milestone: issue.milestone,
										created_at: issue.created_at,
										updated_at: issue.updated_at,
										assignedIds: Array.isArray(recipients) ? recipients.filter(p => p && p.id).map(p => Number(p.id)) : [],
										spentInRange: 0,
										commentsInRange: 0,
										byDate: {},
										quality: {
											hasTitle: Boolean(issue.title && String(issue.title).trim().length > 0),
											hasDescription: Boolean(issue.description && String(issue.description).trim().length > 0),
											labelsCount: Array.isArray(issue.labels) ? issue.labels.length : 0,
											hasStatusLabel: Array.isArray(issue.labels) ? issue.labels.some(l => /status/i.test(String(l))) : false,
											estimateIsZero: !(issue.time_stats && Number(issue.time_stats.time_estimate) > 0),
											spentIsZero: !(issue.time_stats && Number(issue.time_stats.total_time_spent) > 0),
											spentEqualsEstimate: Boolean(issue.time_stats && Number(issue.time_stats.time_estimate) > 0 && Number(issue.time_stats.total_time_spent) === Number(issue.time_stats.time_estimate)),
											descriptionEditsInRange: 0,
											largeOneOffSpends: [],
										},
									};
									if (Array.isArray(issue.labels)) {
										issue.labels.forEach(l => usersMap[uidShare].labels.add(l));
									}
								}
								let appliedDelta = shareSeconds;
								if (isSub) {
									const currentIssueDay = Number(usersMap[uidShare].issues[issue.iid].byDate[noteKey] || 0);
									const appliedAbs = Math.min(currentIssueDay, Math.abs(shareSeconds));
									if (appliedAbs <= 0) continue;
									appliedDelta = -appliedAbs;
								}
								usersMap[uidShare].totalSpent += appliedDelta;
								usersMap[uidShare].issues[issue.iid].spentInRange = Math.max(0, (usersMap[uidShare].issues[issue.iid].spentInRange || 0) + appliedDelta);
								usersMap[uidShare].byDate[noteKey] = Math.max(0, (usersMap[uidShare].byDate[noteKey] || 0) + appliedDelta);
								usersMap[uidShare].issues[issue.iid].byDate[noteKey] = Math.max(0, (usersMap[uidShare].issues[issue.iid].byDate[noteKey] || 0) + appliedDelta);
								if (isAdd && Math.abs(appliedDelta) >= 8 * 3600) {
									usersMap[uidShare].issues[issue.iid].quality.largeOneOffSpends.push({
										at: note.created_at,
										seconds: appliedDelta,
										dateKey: noteKey,
									});
								}
								try {
									console.log('[activity-range][apply][change]', {
										userId: uidShare,
										iid: issue.iid,
										dateKey: noteKey,
										delta: appliedDelta,
										totalSpent: usersMap[uidShare].totalSpent,
									});
								} catch (e) {}

								if (isAdd && delta > 0) {
									if (!Array.isArray(usersMap[uidShare].spendAddLog)) usersMap[uidShare].spendAddLog = [];
									usersMap[uidShare].spendAddLog.push({
										at: note.created_at,
										seconds: shareSeconds,
										issue_iid: issue.iid,
									});
								}
							}

							{
								const noteKey = toKey(note.created_at);
								const body = String(note.body).toLowerCase();
								const authorId = Number(note.author.id);
								// remove all estimate
								if (/\bremoved\s+(?:all\s+)?(?:time\s+estimate|estimate\s+time)\b/i.test(body)) {
									// zero-out estimate regardless of date for consistency
									let assigneesForShare = recipients;
									if (attribution === 'author') {
										assigneesForShare = [{ id: authorId, username: note.author.username, name: note.author.name, avatar_url: note.author.avatar_url }];
									}
									for (const person of assigneesForShare) {
										const uid = Number(person.id);
										if (!userIdsSet.has(uid)) continue;
										if (!usersMap[uid]) {
											usersMap[uid] = {
												userId: uid,
												username: person.username || note.author.username || '',
												name: person.name || note.author.name || '',
												avatar_url: person.avatar_url || note.author.avatar_url || '',
												totalSpent: 0,
												totalEstimate: 0,
												issues: {},
												labels: new Set(),
												byDate: {},
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
												created_at: issue.created_at,
												updated_at: issue.updated_at,
												assignedIds: Array.isArray(recipients) ? recipients.filter(p => p && p.id).map(p => Number(p.id)) : [],
												spentInRange: 0,
												estimateInRange: 0,
												commentsInRange: 0,
												byDate: {},
												estimateByDate: {},
												quality: {
													hasTitle: Boolean(issue.title && String(issue.title).trim().length > 0),
													hasDescription: Boolean(issue.description && String(issue.description).trim().length > 0),
													labelsCount: Array.isArray(issue.labels) ? issue.labels.length : 0,
													hasStatusLabel: Array.isArray(issue.labels) ? issue.labels.some(l => /status/i.test(String(l))) : false,
													estimateIsZero: !(issue.time_stats && Number(issue.time_stats.time_estimate) > 0),
													spentIsZero: !(issue.time_stats && Number(issue.time_stats.total_time_spent) > 0),
													spentEqualsEstimate: Boolean(issue.time_stats && Number(issue.time_stats.time_estimate) > 0 && Number(issue.time_stats.total_time_spent) === Number(issue.time_stats.time_estimate)),
													descriptionEditsInRange: 0,
													largeOneOffSpends: [],
												},
												estimateCurrent: 0,
											};
										}
										const issRec = usersMap[uid].issues[issue.iid];
										const curr = Number(issRec.estimateCurrent || 0);
										const deltaSet = -curr;
										issRec.estimateCurrent = 0;
										// attribution share
										const assigneesCount = attribution === 'author' ? 1 : recipients.length || 1;
										const share = assigneesCount > 0 ? deltaSet / assigneesCount : deltaSet;
										// record to estimateInRange regardless of date (consistent with spent remove-all)
										usersMap[uid].totalEstimate = (usersMap[uid].totalEstimate || 0) + share;
										issRec.estimateInRange = (issRec.estimateInRange || 0) + share;
										issRec.estimateByDate[noteKey] = (issRec.estimateByDate[noteKey] || 0) + share;
									}
								} else {
									const added = body.includes('added') && body.includes('time estimate');
									const removed = (body.includes('subtracted') || body.includes('removed') || body.includes('deleted')) && body.includes('time estimate');
									const changedMatch = body.match(/changed\s+time\s+estimate\s+to\s+(.+?)(?:\.|$)/i);
									if (!(added || removed || changedMatch)) {
										// nothing
									} else {
										let desiredDelta = 0;
										if (changedMatch) {
											let seconds = 0;
											const src = changedMatch[1];
											seconds = parseDurationString(src);
											// desiredDelta = toValue - current
											const curr = Number((usersMap[userIdsSet.has(authorId) ? authorId : recipients[0]?.id] && usersMap[userIdsSet.has(authorId) ? authorId : recipients[0]?.id].issues[issue.iid]?.estimateCurrent) || 0);
											desiredDelta = seconds - curr;
										} else {
											let seconds = 0;
											const srcMatchA = body.match(/(?:added|subtracted|removed|deleted)\s+(.+?)\s+of\s+(?:time\s+estimate|estimate\s+time)/i);
											const srcMatchB = body.match(/(?:added|subtracted|removed|deleted)\s+(?:time\s+estimate|estimate\s+time)\s+of\s+(.+?)(?:\.|$)/i);
											const src = srcMatchA ? srcMatchA[1] : srcMatchB ? srcMatchB[1] : body;

											seconds = parseDurationString(src);
											seconds = Math.abs(seconds);
											desiredDelta = added ? seconds : -seconds;
										}
										// apply per recipients/author; clamp per issue current not to go below zero
										let assigneesForShare = recipients;
										if (attribution === 'author') {
											assigneesForShare = [{ id: authorId, username: note.author.username, name: note.author.name, avatar_url: note.author.avatar_url }];
										}
										// We need a single issue record to track current; pick any target user to hold the shared state if absent
										// We'll ensure issue record exists for each selected user when recording in-range deltas
										// Compute clamp based on a shared current; use a temporary holder
										if (!issue.__estimateCurrentTmp) issue.__estimateCurrentTmp = 0;
										let currShared = issue.__estimateCurrentTmp;
										const clampedDelta = currShared + desiredDelta < 0 ? -currShared : desiredDelta;
										issue.__estimateCurrentTmp = currShared + clampedDelta;
										const baseCount = attribution === 'author' ? 1 : recipients.length || 1;
										const share = baseCount > 0 ? clampedDelta / baseCount : clampedDelta;
										for (const person of assigneesForShare) {
											const uid = Number(person.id);
											if (!userIdsSet.has(uid)) continue;
											if (!usersMap[uid]) {
												usersMap[uid] = {
													userId: uid,
													username: person.username || note.author.username || '',
													name: person.name || note.author.name || '',
													avatar_url: person.avatar_url || note.author.avatar_url || '',
													totalSpent: 0,
													totalEstimate: 0,
													issues: {},
													labels: new Set(),
													byDate: {},
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
													created_at: issue.created_at,
													updated_at: issue.updated_at,
													assignedIds: Array.isArray(recipients) ? recipients.filter(p => p && p.id).map(p => Number(p.id)) : [],
													spentInRange: 0,
													estimateInRange: 0,
													commentsInRange: 0,
													byDate: {},
													estimateByDate: {},
													quality: {
														hasTitle: Boolean(issue.title && String(issue.title).trim().length > 0),
														hasDescription: Boolean(issue.description && String(issue.description).trim().length > 0),
														labelsCount: Array.isArray(issue.labels) ? issue.labels.length : 0,
														hasStatusLabel: Array.isArray(issue.labels) ? issue.labels.some(l => /status/i.test(String(l))) : false,
														estimateIsZero: !(issue.time_stats && Number(issue.time_stats.time_estimate) > 0),
														spentIsZero: !(issue.time_stats && Number(issue.time_stats.total_time_spent) > 0),
														spentEqualsEstimate: Boolean(issue.time_stats && Number(issue.time_stats.time_estimate) > 0 && Number(issue.time_stats.total_time_spent) === Number(issue.time_stats.time_estimate)),
														descriptionEditsInRange: 0,
														largeOneOffSpends: [],
													},
													estimateCurrent: 0,
												};
											}
											usersMap[uid].totalEstimate = (usersMap[uid].totalEstimate || 0) + share;
											usersMap[uid].issues[issue.iid].estimateInRange = (usersMap[uid].issues[issue.iid].estimateInRange || 0) + share;
											usersMap[uid].issues[issue.iid].estimateByDate[noteKey] = (usersMap[uid].issues[issue.iid].estimateByDate[noteKey] || 0) + share;
										}
									}
								}
							}
						}
					}

					if (Array.isArray(userNotes)) {
						const notes = [...userNotes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
						try {
							console.log('[activity-range][notes][user] iid=', issue.iid, 'count=', Array.isArray(notes) ? notes.length : 0);
						} catch (e) {}
						for (const note of notes) {
							if (note?.system) continue;
							if (!note?.created_at || !note?.author?.id) continue;
							const noteKey = toKey(note.created_at);
							if (!isInRange(noteKey)) continue;
							const authorId = Number(note.author.id);
							if (!userIds.includes(authorId)) continue;
							const isAssignee = recipients.some(p => p && Number(p.id) === authorId);
							// collaboration: user commented but is not an assignee
							if (!isAssignee) {
								// initialize user record if needed
								if (!usersMap[authorId]) {
									usersMap[authorId] = {
										userId: authorId,
										username: note.author.username || '',
										name: note.author.name || '',
										avatar_url: note.author.avatar_url || '',
										totalSpent: 0,
										issues: {},
										labels: new Set(),
										byDate: {},
										collaborationNotes: [],
									};
								}
								if (!Array.isArray(usersMap[authorId].collaborationNotes)) usersMap[authorId].collaborationNotes = [];
								usersMap[authorId].collaborationNotes.push({
									issue_iid: issue.iid,
									at: note.created_at,
									dateKey: noteKey,
								});
								continue;
							}

							if (!usersMap[authorId]) {
								usersMap[authorId] = {
									userId: authorId,
									username: note.author.username || '',
									name: note.author.name || '',
									avatar_url: note.author.avatar_url || '',
									totalSpent: 0,
									issues: {},
									labels: new Set(),
									byDate: {},
								};
							}
							if (!usersMap[authorId].issues[issue.iid]) {
								usersMap[authorId].issues[issue.iid] = {
									iid: issue.iid,
									title: issue.title,
									state: issue.state,
									labels: issue.labels,
									time_stats: issue.time_stats,
									milestone: issue.milestone,
									created_at: issue.created_at,
									updated_at: issue.updated_at,
									assignedIds: Array.isArray(recipients) ? recipients.filter(p => p && p.id).map(p => Number(p.id)) : [],
									spentInRange: 0,
									commentsInRange: 0,
									quality: {
										hasTitle: Boolean(issue.title && String(issue.title).trim().length > 0),
										hasDescription: Boolean(issue.description && String(issue.description).trim().length > 0),
										labelsCount: Array.isArray(issue.labels) ? issue.labels.length : 0,
										hasStatusLabel: Array.isArray(issue.labels) ? issue.labels.some(l => /status/i.test(String(l))) : false,
										estimateIsZero: !(issue.time_stats && Number(issue.time_stats.time_estimate) > 0),
										spentIsZero: !(issue.time_stats && Number(issue.time_stats.total_time_spent) > 0),
										spentEqualsEstimate: Boolean(issue.time_stats && Number(issue.time_stats.time_estimate) > 0 && Number(issue.time_stats.total_time_spent) === Number(issue.time_stats.time_estimate)),
										descriptionEditsInRange: 0,
										largeOneOffSpends: [],
									},
								};
								if (Array.isArray(issue.labels)) {
									issue.labels.forEach(l => usersMap[authorId].labels.add(l));
								}
							}
							usersMap[authorId].issues[issue.iid].commentsInRange += 1;

							const lastEditedAt = note.last_edited_at || note.updated_at;
							const editor = note.last_edited_by || note.editor || note.author;
							if (lastEditedAt) {
								const editKey = toKey(lastEditedAt);
								if (isInRange(editKey) && editor && Number(editor.id) === authorId && note.created_at !== lastEditedAt) {
									const bodyStr = typeof note.body === 'string' ? note.body.toLowerCase() : '';
									if (bodyStr.includes('description') || bodyStr.includes('edited') || bodyStr.includes('changed')) {
										usersMap[authorId].issues[issue.iid].quality.descriptionEditsInRange += 1;
									}
								}
							}
						}
					}
				})
			);
		}

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

		for (const u of Object.values(usersMap)) {
			u.emptyIssues = [];
		}
		for (const issue of allIssues) {
			// ایشو خالی یعنی هیچ estimate و هیچ spent ندارد
			const isEmpty = !issue.time_stats || (!Number(issue.time_stats.time_estimate) && !Number(issue.time_stats.total_time_spent)) || (Number(issue.time_stats.time_estimate) === 0 && Number(issue.time_stats.total_time_spent) === 0);
			if (!isEmpty) continue;
			// کاربران assign شده به این ایشو
			const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
			const legacy = issue.assignee ? [issue.assignee] : [];
			const recipients = assignees.length > 0 ? assignees : legacy;
			for (const person of recipients) {
				if (!person || !person.id) continue;
				const uid = Number(person.id);
				if (!usersMap[uid]) continue;
				// اطلاعات کامل ایشو + isEmpty
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

		for (const u of Object.values(usersMap)) {
			try {
				const byDatePreview = Object.entries(u.byDate || {}).slice(0, 10);
				console.log('[activity-range][aggregate][user]', {
					userId: u.userId,
					username: u.username,
					totalIssues: Object.keys(u.issues || {}).length,
					totalSpentPreview: Object.values(u.byDate || {}).reduce((a, b) => a + b, 0),
					byDatePreview,
				});
			} catch (e) {}
			let totalIssueCount = 0;
			// let realnessSum = 0;
			let suspiciousIssueCount = 0;

			for (const u of Object.values(usersMap)) {
				if (!u.byDate) u.byDate = {};
				if (!u.issues) u.issues = {};
			}

			const daily = workingDateKeys.map(k => {
				const issueList = Object.values(u.issues || {});
				const issuesArr = issueList.map(iss => ({ iid: iss.iid, spent: (iss.byDate && iss.byDate[k]) || 0 })).filter(x => x.spent !== 0);

				const totalForDay = issueList.reduce((sum, iss) => {
					return sum + (iss.byDate && iss.byDate[k] ? Number(iss.byDate[k]) : 0);
				}, 0);

				return {
					date: k,
					spent: totalForDay,
					issues: issuesArr,
					issueIids: issuesArr.map(it => it.iid),
				};
			});

			const H = 3600;
			// --- New percent-based thresholds (base day = 8h20m = 30000s by default) ---
			const qBaseSec = Number(req.query.base_seconds ?? process.env.BASE_DAY_SECONDS ?? 30000);
			const baseDaySeconds = Number.isFinite(qBaseSec) ? qBaseSec : 30000; // 8h20m
			const qMinPercent = Number(req.query.min_percent ?? process.env.MIN_PERCENT ?? 0.3);
			const qNormalHighPercent = Number(req.query.normal_high_percent ?? process.env.NORMAL_HIGH_PERCENT ?? 0.7);
			const qPositiveLowPercent = Number(req.query.positive_low_percent ?? process.env.POSITIVE_LOW_PERCENT ?? 0.6);
			const qPositiveHighPercent = Number(req.query.positive_high_percent ?? process.env.POSITIVE_HIGH_PERCENT ?? 0.9);
			const qMaxCapHours = Number(req.query.max_cap_hours ?? process.env.MAX_CAP_HOURS ?? 10);
			const targetMin = (Number.isFinite(qMinPercent) ? qMinPercent : 0.3) * baseDaySeconds; // 30%
			const targetMax = (Number.isFinite(qNormalHighPercent) ? qNormalHighPercent : 0.7) * baseDaySeconds; // 70%
			const positiveLow = (Number.isFinite(qPositiveLowPercent) ? qPositiveLowPercent : 0.6) * baseDaySeconds; // 60%
			const overworkSoft = (Number.isFinite(qPositiveHighPercent) ? qPositiveHighPercent : 0.9) * baseDaySeconds; // 90%
			const maxCapSeconds = (Number.isFinite(qMaxCapHours) ? qMaxCapHours : 10) * H; // up to 10h is okay (excellent, no points)
			const qFakeSpendH = Number(req.query.fake_spend_hours ?? process.env.FAKE_SPEND_HOURS ?? 5);
			const fakeSpendThreshold = (Number.isFinite(qFakeSpendH) ? qFakeSpendH : 5) * H; // one-off spend anomaly threshold
			let daysBelowMin = 0;
			let daysAboveMax = 0;
			let daysFake = 0;
			let daysPositive = 0; // 60%..90% of base
			let daysOver90NoPoint = 0; // >90%..<=10h
			let healthyDays = 0;
			let totalDays = daily.length;
			let activeDays = 0;
			let totalSpent = 0;
			let totalEstimate = 0;
			let fakeDaysDetails = [];

			// بررسی spend هر روز
			for (const d of daily) {
				totalSpent += d.spent;
				if (d.spent > 0) {
					activeDays += 1;
					if (d.spent < targetMin) {
						daysBelowMin += 1;
					} else if (d.spent >= targetMin && d.spent <= targetMax) {
						healthyDays += 1;
					}
					if (d.spent >= positiveLow && d.spent <= overworkSoft) {
						daysPositive += 1; // positive band 60%..90%
					}
					if (d.spent > targetMax && d.spent <= overworkSoft) {
						daysAboveMax += 1; // 70%..90%
					} else if (d.spent > overworkSoft && d.spent <= maxCapSeconds) {
						daysOver90NoPoint += 1; // >90%..<=10h (excellent, no points)
					} else if (d.spent > maxCapSeconds) {
						daysFake += 1; // >10h
						fakeDaysDetails.push({ date: d.date, spent: d.spent });
					}
				}
			}

			// محاسبه estimate از روی تغییرات ثبت‌شده در بازه (پایدار در برابر add/remove/change)
			for (const iss of Object.values(u.issues)) {
				const v = Number(iss?.estimateInRange) || 0;
				totalEstimate += v;
			}

			// بررسی spendهای یکجا (largeOneOffSpends)
			let largeOneOffSpendsCount = 0;
			for (const iss of Object.values(u.issues)) {
				const q = iss.quality || {};
				if (Array.isArray(q.largeOneOffSpends)) {
					for (const s of q.largeOneOffSpends) {
						if (s.seconds >= fakeSpendThreshold) {
							largeOneOffSpendsCount++;
							fakeDaysDetails.push({ date: s.at, spent: s.seconds, type: 'largeOneOff' });
						}
					}
				}
			}

			// --- تحلیل افزایش‌های مشکوک spend بر اساس لاگ‌ها ---
			let suspiciousIncrementCount = 0;
			if (Array.isArray(u.spendAddLog) && u.spendAddLog.length > 1) {
				const ordered = [...u.spendAddLog].sort((a, b) => new Date(a.at) - new Date(b.at));
				for (let i = 1; i < ordered.length; i++) {
					const prev = ordered[i - 1];
					const curr = ordered[i];
					if (prev && curr && prev.seconds > 0 && curr.seconds > 0) {
						// اگر قبلی حدود 1h و بعدی 2h باشد (یا نسبت 1:2 با تلورانس)
						const ratio = curr.seconds / prev.seconds;
						if (ratio >= 1.9 && ratio <= 2.1 && prev.seconds >= 50 * 60 && prev.seconds <= 70 * 60) {
							suspiciousIncrementCount += 1;
						}
					}
				}
			}

			// امتیازدهی realness
			let realnessScore = 1.0;
			// کم‌کاری
			if (daysBelowMin > 0) realnessScore -= Math.min(0.2, 0.03 * daysBelowMin);
			// normal (30%..70%): no bonus, no penalty
			// positive band (60%..90%): give positive points
			if (daysPositive > 0) realnessScore += Math.min(0.12, 0.012 * daysPositive);
			// >90%..<=10h: excellent but no points (no change)
			// fake spend (>10h)
			if (daysFake > 0) realnessScore -= Math.min(0.5, 0.15 * daysFake);
			// fake spend خیلی زیاد (بیش از ۱۲ ساعت)
			const daysExtremeFake = daily.filter(d => d.spent > 12 * H).length;
			if (daysExtremeFake > 0) realnessScore -= Math.min(0.6, 0.25 * daysExtremeFake);
			// large one-off spends
			if (largeOneOffSpendsCount > 0) realnessScore -= Math.min(0.4, 0.1 * largeOneOffSpendsCount);
			// افزایش‌های مشکوک (پنالتی کم به دلیل احتمال خطا)
			if (suspiciousIncrementCount > 0) realnessScore -= Math.min(0.05, 0.01 * suspiciousIncrementCount);
			// محدودیت امتیاز
			realnessScore = Math.max(0, Math.min(1, realnessScore));

			// quality و امتیاز ایشوها (در گام بعدی کامل‌تر می‌شود)
			for (const iss of Object.values(u.issues)) {
				const q = iss.quality || {};
				const reasons = [];
				if (q.hasTitle === false) reasons.push('missing_title');
				if (q.hasDescription === false) reasons.push('missing_description');
				if (q.spentEqualsEstimate === true) reasons.push('spent_equals_estimate');
				if (q.spentIsZero === true) reasons.push('no_spent');
				if (q.estimateIsZero === true) reasons.push('no_estimate');
				if ((q.labelsCount || 0) <= 3) reasons.push('few_labels');
				if (q.hasStatusLabel === false) reasons.push('missing_status_label');
				if ((q.descriptionEditsInRange || 0) >= 3) reasons.push('many_description_edits');
				const hasBigOneOff = Array.isArray(q.largeOneOffSpends) && q.largeOneOffSpends.length > 0;
				if (hasBigOneOff) reasons.push('large_one_off_spend');
				iss.suspiciousReasons = reasons;
				totalIssueCount += 1;
				if (reasons.length > 0) suspiciousIssueCount += 1;
			}

			u.totalIssueCount = totalIssueCount;
			u.suspiciousIssueCount = suspiciousIssueCount;
			u.realnessPercent = Number((realnessScore * 100).toFixed(2));
			u.daysBelowMin = daysBelowMin;
			u.daysAboveMax = daysAboveMax;
			u.daysFake = daysFake;
			u.healthyDays = healthyDays;
			u.totalDays = totalDays;
			u.activeDays = activeDays;
			u.fakeDaysDetails = fakeDaysDetails;
			u.largeOneOffSpendsCount = largeOneOffSpendsCount;
			u.daysPositive = daysPositive; // 60%..90%
			u.daysOver90NoPoint = daysOver90NoPoint; // >90%..<=10h
			u.totalSpent = totalSpent;
			// --- ساخت خلاصه روزانه estimate بر اساس per-issue estimateByDate ---
			let estimateDaily = workingDateKeys.map(k => {
				const issuesArr = [];
				let estSum = 0;
				for (const iss of Object.values(u.issues || {})) {
					const v = (iss.estimateByDate && iss.estimateByDate[k]) || 0;
					if (v > 0) {
						issuesArr.push({ iid: iss.iid, seconds: v, hm: `${Math.floor(v / 3600)}h ${Math.floor((v % 3600) / 60)}m` });
						estSum += v;
					}
				}
				const issueIids = issuesArr.map(it => it.iid);
				return {
					date: k,
					estimate: estSum,
					estimate_hm: `${Math.floor(estSum / 3600)}h ${Math.floor((estSum % 3600) / 60)}m`,
					issues: issuesArr,
					issueIids,
				};
			});
			// Fallback: if no estimate changes occurred within range but issues have current estimates,
			// attribute each issue's current time_estimate to the first in-range activity date for that issue
			// (or the first working day if no activity days), so users can see non-zero estimates in the period.
			const totalDailyEst = estimateDaily.reduce((s, d) => s + (d.estimate || 0), 0);
			if (totalDailyEst === 0 && workingDateKeys.length > 0) {
				const firstDay = workingDateKeys[0];
				for (const iss of Object.values(u.issues || {})) {
					const currentEstimate = Number(iss?.time_stats?.time_estimate || 0);
					if (!currentEstimate || currentEstimate <= 0) continue;
					// find first in-range activity date for this issue for this user
					const perDay = iss.byDate || {};
					const activeDay =
						Object.keys(perDay)
							.filter(k => workingDateKeys.includes(k) && Number(perDay[k] || 0) > 0)
							.sort()[0] || firstDay;
					const dayObj = estimateDaily.find(d => d.date === activeDay);
					if (dayObj) {
						dayObj.estimate += currentEstimate;
						dayObj.estimate_hm = `${Math.floor(dayObj.estimate / 3600)}h ${Math.floor((dayObj.estimate % 3600) / 60)}m`;
						dayObj.issues.push({ iid: iss.iid, seconds: currentEstimate, hm: `${Math.floor(currentEstimate / 3600)}h ${Math.floor((currentEstimate % 3600) / 60)}m` });
						dayObj.issueIids = Array.from(new Set([...(dayObj.issueIids || []), iss.iid]));
					}
				}
			}
			// پس از اعمال fallback، totalEstimate را از روی خلاصه نهایی روزانه محاسبه کن
			const totalEstimateFinal = estimateDaily.reduce((s, d) => s + (d.estimate || 0), 0);
			u.totalEstimate = totalEstimateFinal;
			u.estimateDailySummary = estimateDaily;
			u.dailySummary = daily.map(d => ({
				date: d.date,
				spent: d.spent,
				spent_hm: `${Math.floor(d.spent / 3600)}h ${Math.floor((d.spent % 3600) / 60)}m`,
				issues: d.issues,
				issueIids: d.issueIids,
			}));
			// --- شاخص‌های جدید quality برای هر ایشو ---
			for (const iss of Object.values(u.issues)) {
				const q = iss.quality || {};
				// توزیع spend در روزهای مختلف
				const spentDistribution = {};
				if (iss.spentInRange && iss.byDate) {
					for (const [date, spent] of Object.entries(iss.byDate)) {
						if (spent > 0) spentDistribution[date] = spent;
					}
				}
				q.spentDistributionDays = Object.keys(spentDistribution).length;
				// تعداد ویرایش توضیح
				q.descriptionEdits = q.descriptionEditsInRange || 0;
				// نسبت spent به estimate
				const estimate = Number(iss?.time_stats?.time_estimate) || 0;
				const spentInRange = Number(iss?.spentInRange) || 0;
				q.spentToEstimateRatio = estimate > 0 ? Number(spentInRange / estimate).toFixed(2) : null;
				// تعداد کامنت مفید
				q.commentsInRange = iss.commentsInRange || 0;
				// --- شاخص کیفیت کلی ایشو (qualityScore)
				let qualityScore = 1.0;
				const qualityPenalties = [];
				if (q.hasTitle === false) {
					qualityScore -= 0.18;
					qualityPenalties.push('missing_title');
				}
				if (q.hasDescription === false) {
					qualityScore -= 0.18;
					qualityPenalties.push('missing_description');
				}
				if (q.spentEqualsEstimate === true) {
					qualityScore -= 0.22;
					qualityPenalties.push('spent_equals_estimate');
				}
				if (q.spentIsZero === true) {
					qualityScore -= 0.18;
					qualityPenalties.push('no_spent');
				}
				if (q.estimateIsZero === true) {
					qualityScore -= 0.18;
					qualityPenalties.push('no_estimate');
				}
				if ((q.labelsCount || 0) <= 3) {
					qualityScore -= 0.12;
					qualityPenalties.push('few_labels');
				}
				if ((q.labelsCount || 0) <= 1) {
					qualityScore -= 0.1;
					qualityPenalties.push('very_few_labels');
				}
				if (q.hasStatusLabel === false) {
					qualityScore -= 0.12;
					qualityPenalties.push('missing_status_label');
				}
				if ((q.descriptionEditsInRange || 0) >= 3) {
					qualityScore -= 0.15;
					qualityPenalties.push('many_description_edits');
				}
				if (Array.isArray(q.largeOneOffSpends) && q.largeOneOffSpends.length > 0) {
					qualityScore -= 0.22;
					qualityPenalties.push('large_one_off_spend');
				}
				// spent توزیع نشده (همه در یک روز)
				if (q.spentDistributionDays <= 1 && iss.spentInRange > 2 * 3600) {
					qualityScore -= 0.18;
					qualityPenalties.push('undistributed_spend');
				}
				// نسبت spent به estimate خیلی کم یا زیاد
				if (q.spentToEstimateRatio && (q.spentToEstimateRatio < 0.5 || q.spentToEstimateRatio > 1.5)) {
					qualityScore -= 0.15;
					qualityPenalties.push('bad_spent_to_estimate_ratio');
				}
				// تعداد کامنت مفید کم
				if (q.commentsInRange < 1) {
					qualityScore -= 0.08;
					qualityPenalties.push('few_comments');
				}
				// اگر بیش از ۳ مورد مشکل quality وجود داشته باشد، جریمه اضافی
				if (qualityPenalties.length >= 3) qualityScore -= 0.15;
				// محدودیت امتیاز
				qualityScore = Math.max(0, Math.min(1, qualityScore));
				q.qualityScore = Number(qualityScore.toFixed(2));
				q.qualityPenalties = qualityPenalties;
				// پاداش همراستایی spent و estimate: هرچه نسبت نزدیک‌تر به ۱، امتیاز بهتر
				// از نسبت spentToEstimateRatio استفاده می‌کنیم که در بالا محاسبه شد
				let estimateAlignment = 0;
				if (q.spentToEstimateRatio !== null && q.spentToEstimateRatio !== undefined) {
					const ratioNum = Number(q.spentToEstimateRatio);
					if (!Number.isNaN(ratioNum)) {
						const diff = Math.abs(1 - ratioNum);
						// نگاشت دیف به بازه [0,1] (هرچه کمتر بهتر)
						const alignment = Math.max(0, 1 - Math.min(1, diff));
						estimateAlignment = Number(alignment.toFixed(2));
					}
				}
				q.estimateAlignment = estimateAlignment; // برای گزارش‌گیری
				iss.quality = q;
			}

			// --- summary برای هر یوزر ---
			u.summary = {
				totalDays: u.totalDays,
				healthyDays: u.healthyDays,
				daysBelowMin: u.daysBelowMin,
				daysAboveMax: u.daysAboveMax,
				daysFake: u.daysFake,
				largeOneOffSpendsCount: u.largeOneOffSpendsCount,
				suspiciousIncrementCount: suspiciousIncrementCount,
				totalSpent: u.totalSpent,
				totalEstimate: u.totalEstimate,
				spentToEstimate: u.totalEstimate > 0 ? Number((u.totalSpent / u.totalEstimate).toFixed(2)) : null,
				avgDailySpent: u.activeDays > 0 ? Math.round(u.totalSpent / u.activeDays) : 0,
				realnessPercent: u.realnessPercent,
				suspiciousIssueCount: u.suspiciousIssueCount,
				totalIssueCount: u.totalIssueCount,
				fakeDaysDetails: u.fakeDaysDetails,
				qualityDistribution: {
					good: Object.values(u.issues).filter(iss => iss.quality?.qualityScore >= 0.8).length,
					medium: Object.values(u.issues).filter(iss => iss.quality?.qualityScore >= 0.5 && iss.quality?.qualityScore < 0.8).length,
					weak: Object.values(u.issues).filter(iss => iss.quality?.qualityScore < 0.5).length,
				},
				largeOneOffSpends: Object.values(u.issues).flatMap(iss => (iss.quality?.largeOneOffSpends || []).map(s => ({ iid: iss.iid, at: s.at, seconds: s.seconds, dateKey: s.dateKey }))),
			};
			// --- trend و پیام راهنما برای هر یوزر ---
			let guidance = [];
			// پیام absence کلی
			if (u.absenceCount > 0) {
				guidance.push(`در ${u.absenceCount} روز (${u.absenceDays.join(', ')}) هیچ فعالیتی ثبت نشده است.`);
			}
			// پیام fake spend کلی
			if (u.daysFake > 0) {
				const fakeDates = u.fakeDaysDetails.filter(f => !f.type).map(f => f.date);
				if (fakeDates.length > 0) guidance.push(`در روزهای ${fakeDates.join(', ')} spend غیرواقعی (بیش از ۱۰ ساعت) ثبت شده است.`);
				const extremeFakeDates = u.dailySummary.filter(d => d.spent > 12 * 3600).map(d => d.date);
				if (extremeFakeDates.length > 0) guidance.push(`در روزهای ${extremeFakeDates.join(', ')} spend بسیار غیرواقعی (بیش از ۱۲ ساعت) ثبت شده است.`);
			}
			// پیام spend کمتر از حداقل
			const belowMinDates = u.dailySummary.filter(d => d.spent > 0 && d.spent < targetMin).map(d => d.date);
			if (belowMinDates.length > 0) guidance.push(`در روزهای ${belowMinDates.join(', ')} کمتر از حداقل ساعات کاری spend ثبت شده است.`);
			// پیام large one-off spends
			if (u.largeOneOffSpendsCount > 0) guidance.push('چند spend بزرگ یکجا ثبت شده که مشکوک به فیک بودن است.');
			// پیام افزایش‌های مشکوک
			if (u.suspiciousIncrementCount > 0) guidance.push(`در ${u.suspiciousIncrementCount} مورد افزایش مشکوک spend (۱ ساعت → ۲ ساعت) مشاهده شد.`);
			// کیفیت ایشوها
			if (u.summary.qualityDistribution.weak > 0) guidance.push('برخی ایشوها کیفیت پایینی دارند. لطفاً عنوان، توضیح و برآورد زمانی را کامل‌تر وارد کنید.');
			if (u.summary.qualityDistribution.good === 0) guidance.push('هیچ ایشوی با کیفیت عالی ثبت نشده است.');
			// پیام مثبت absence
			if (u.absenceCount === 0) guidance.push('در تمام روزهای کاری این بازه فعالیت ثبت شده است. آفرین!');
			// پیام مثبت quality
			if (u.summary.qualityDistribution.weak === 0 && u.summary.qualityDistribution.good > 0) guidance.push('تمام ایشوهای شما کیفیت قابل قبولی دارند.');
			// trend عملکرد (ساده: مقایسه نیمه اول و دوم بازه)
			let trend = 'stable';
			if (u.dailySummary && u.dailySummary.length > 4) {
				const mid = Math.floor(u.dailySummary.length / 2);
				const firstHalfSum = u.dailySummary.slice(0, mid).reduce((a, b) => a + b.spent, 0);
				const secondHalfSum = u.dailySummary.slice(mid).reduce((a, b) => a + b.spent, 0);
				const firstHalf = firstHalfSum / (mid || 1);
				const secondHalf = secondHalfSum / (u.dailySummary.length - mid || 1);
				const totalSum = firstHalfSum + secondHalfSum;
				const H = 3600;
				const minSpendForTrend = 3 * H; // حداقل ۳ ساعت مجموع برای تحلیل روند
				const minAbsoluteDelta = 1 * H; // حداقل اختلاف میانگین ۱ ساعت
				if (totalSum >= minSpendForTrend) {
					if (secondHalf > firstHalf * 1.1 && secondHalf - firstHalf >= minAbsoluteDelta) trend = 'improving';
					else if (secondHalf < firstHalf * 0.9 && firstHalf - secondHalf >= minAbsoluteDelta) trend = 'declining';
				}
			}
			u.summary.guidance = guidance;
			u.summary.trend = trend;
			// --- شناسایی absence (روزهای بدون فعالیت) ---
			const absenceDays = [];
			const allDates = workingDateKeys;
			for (const date of allDates) {
				const spent = u.byDate && u.byDate[date] ? u.byDate[date] : 0;
				if (spent === 0) absenceDays.push(date);
			}
			u.absenceDays = absenceDays;
			u.absenceCount = absenceDays.length;
			// --- گسترش dailySummary برای نمایش روزهای غیبت با spent صفر ---
			try {
				const currentSummary = Array.isArray(u.dailySummary) ? u.dailySummary : [];
				const currentDates = new Set(currentSummary.map(d => d.date));
				const expandedDaily = currentSummary.slice();
				for (const date of allDates) {
					if (!currentDates.has(date)) {
						expandedDaily.push({
							date,
							spent: 0,
							spent_hm: '0h 0m',
							isAbsence: true,
						});
					}
				}
				expandedDaily.sort((a, b) => a.date.localeCompare(b.date));
				u.dailySummary = expandedDaily;
			} catch (e) {
				// ignore expansion errors to avoid breaking existing logic
			}
			// --- بروزرسانی totalDays بر اساس روزهای کاری بازه ---
			try {
				const workingDaysCount = allDates.length;
				u.totalDays = workingDaysCount;
				if (u.summary) {
					u.summary.totalDays = workingDaysCount;
					const newAvg = (u.activeDays || 0) > 0 ? Math.round((u.totalSpent || 0) / (u.activeDays || 1)) : 0;
					u.summary.avgDailySpent = newAvg;
				}
			} catch (e) {}
			// --- محاسبه دوباره trend بر اساس dailySummary توسعه‌یافته ---
			try {
				if (u.dailySummary && u.dailySummary.length > 4) {
					const mid = Math.floor(u.dailySummary.length / 2);
					const firstHalfSum = u.dailySummary.slice(0, mid).reduce((a, b) => a + b.spent, 0);
					const secondHalfSum = u.dailySummary.slice(mid).reduce((a, b) => a + b.spent, 0);
					const firstHalf = firstHalfSum / (mid || 1);
					const secondHalf = secondHalfSum / (u.dailySummary.length - mid || 1);
					let trend = 'stable';
					const H = 3600;
					const minSpendForTrend = 3 * H;
					const minAbsoluteDelta = 1 * H;
					if (firstHalfSum + secondHalfSum >= minSpendForTrend) {
						if (secondHalf > firstHalf * 1.1 && secondHalf - firstHalf >= minAbsoluteDelta) trend = 'improving';
						else if (secondHalf < firstHalf * 0.9 && firstHalf - secondHalf >= minAbsoluteDelta) trend = 'declining';
					}
					if (!u.summary) u.summary = {};
					u.summary.trend = trend;
				}
			} catch (e) {}
			// عدم اعمال جریمه بابت absence طبق نیازمندی‌ها
			if (!u.summary) u.summary = {};
			if (!u.summary.guidance) u.summary.guidance = [];
			// --- guidance تاریخ‌دار absence ---
			for (const date of absenceDays) {
				u.summary.guidance.push(`در تاریخ ${date} هیچ فعالیتی ثبت نشده است.`);
			}
			// --- guidance fake spend و زیر حداقل ---
			if (u.dailySummary) {
				for (const day of u.dailySummary) {
					if (day.spent === 0) continue;
					if (day.spent < 8 * 3600) {
						u.summary.guidance.push(`در تاریخ ${day.date} کمتر از حداقل ساعات کاری spend ثبت شده است.`);
					} else if (day.spent > 9 * 3600) {
						u.summary.guidance.push(`در تاریخ ${day.date} spend غیرواقعی (بیش از ۹ ساعت) ثبت شده است.`);
					}
				}
			}
			u.summary.absenceDays = absenceDays;
			u.summary.absenceCount = absenceDays.length;
			// --- دلایل فارسی برای suspiciousReasons هر ایشو ---
			const reasonMap = {
				missing_title: 'عنوان وارد نشده است.',
				missing_description: 'توضیحات وارد نشده است.',
				spent_equals_estimate: 'spent دقیقاً برابر estimate است (غیرواقعی به نظر می‌رسد).',
				no_spent: 'هیچ spent ثبت نشده است.',
				no_estimate: 'هیچ برآورد زمانی ثبت نشده است.',
				few_labels: 'تعداد لیبل کمتر از حداقل است.',
				missing_status_label: 'لیبل وضعیت ثبت نشده است.',
				many_description_edits: 'توضیحات ایشو بیش از حد ویرایش شده است.',
				large_one_off_spend: 'یک spend بزرگ یکجا ثبت شده است.',
			};
			for (const iss of Object.values(u.issues)) {
				if (Array.isArray(iss.suspiciousReasons) && iss.suspiciousReasons.length > 0) {
					iss.suspiciousReasonsText = iss.suspiciousReasons.map(r => reasonMap[r] || r);
				} else {
					iss.suspiciousReasonsText = [];
				}
			}
			// --- breakdown امتیازها ---
			// realness: درصد واقعیت فعالیت (۰ تا ۱)
			const realnessScoreBreakdown = (u.realnessPercent || 0) / 100;
			// quality: میانگین qualityScore ایشوها (۰ تا ۱)
			let qualityScoreBreakdown = 0;
			let qualityCountBreakdown = 0;
			for (const iss of Object.values(u.issues)) {
				if (iss.quality && typeof iss.quality.qualityScore === 'number') {
					qualityScoreBreakdown += iss.quality.qualityScore;
					qualityCountBreakdown++;
				}
			}
			qualityScoreBreakdown = qualityCountBreakdown > 0 ? qualityScoreBreakdown / qualityCountBreakdown : 0;
			// absence: جریمه اعمال نمی‌شود؛ نسبت را صفر نگه می‌داریم
			const absenceRatioBreakdown = 0;
			// totalScore: ترکیبی از وزن‌های پویا
			let totalScore = Math.max(0, Math.min(1, weights.realness * realnessScoreBreakdown + weights.quality * qualityScoreBreakdown + weights.absence * (1 - absenceRatioBreakdown)));
			// پاداش همراستایی spent و estimate در سطح یوزر (میانگین alignment آیتم‌ها)
			let userEstimateAlignment = 0;
			let userEstimateAlignmentCount = 0;
			for (const iss of Object.values(u.issues)) {
				const q = iss.quality || {};
				if (typeof q.estimateAlignment === 'number') {
					userEstimateAlignment += q.estimateAlignment;
					userEstimateAlignmentCount += 1;
				}
			}
			userEstimateAlignment = userEstimateAlignmentCount > 0 ? userEstimateAlignment / userEstimateAlignmentCount : 0;
			// حداکثر ۰.05 امتیاز اضافه بر اساس همراستایی خوب
			const estimateBonus = Math.min(0.05, 0.05 * userEstimateAlignment);
			totalScore = Math.min(1, totalScore + estimateBonus);
			// اضافه به summary
			if (!u.summary) u.summary = {};
			u.summary.scores = {
				realness: Number(realnessScoreBreakdown.toFixed(2)),
				quality: Number(qualityScoreBreakdown.toFixed(2)),
				absence: Number(absenceRatioBreakdown.toFixed(2)),
				totalScore: Number(totalScore.toFixed(2)),
				estimateAlignment: Number(userEstimateAlignment.toFixed(2)),
			};
			u.summary.weightsUsed = { ...weights };
			// --- guidance مثبت و منفی بر اساس trend ---
			if (u.summary && u.summary.trend) {
				if (u.summary.trend === 'improving') {
					u.summary.guidance.push('عملکرد شما در روزهای اخیر رو به بهبود است. ادامه دهید!');
				} else if (u.summary.trend === 'declining') {
					u.summary.guidance.push('عملکرد شما در روزهای اخیر افت داشته است. لطفاً دقت بیشتری داشته باشید.');
				}
			}
			// پیام راهنما بر اساس همراستایی estimate/spent
			if (u.summary && typeof u.summary.scores?.estimateAlignment === 'number') {
				if (u.summary.scores.estimateAlignment >= 0.8) {
					u.summary.guidance.push('همراستایی خوبی بین زمان برآورد و زمان مصرف‌شده دارید.');
				} else if (u.summary.scores.estimateAlignment <= 0.3) {
					u.summary.guidance.push('اختلاف قابل توجهی بین estimate و spent دیده می‌شود. دقت در ثبت زمان را افزایش دهید.');
				}
			}
			// --- تحلیل توزیع spend در روزهای بازه ---
			if (u.dailySummary && u.dailySummary.length > 0) {
				const totalSpent = u.dailySummary.reduce((sum, d) => sum + d.spent, 0);
				const sortedDays = [...u.dailySummary].sort((a, b) => b.spent - a.spent);
				const top1 = sortedDays[0]?.spent || 0;
				const top2 = sortedDays[1]?.spent || 0;
				const top1Percent = totalSpent > 0 ? top1 / totalSpent : 0;
				const top2Percent = totalSpent > 0 ? (top1 + top2) / totalSpent : 0;
				u.summary.spendDistribution = {
					top1Percent: Number((top1Percent * 100).toFixed(1)),
					top2Percent: Number((top2Percent * 100).toFixed(1)),
				};
				if (top1Percent > 0.6) {
					u.summary.guidance.push('بیش از ۶۰٪ spend شما فقط در یک روز ثبت شده است. لطفاً spend را به صورت منظم‌تر در روزهای مختلف وارد کنید.');
				} else if (top2Percent > 0.6) {
					u.summary.guidance.push('بیش از ۶۰٪ spend شما فقط در دو روز ثبت شده است. بهتر است spend را در روزهای بیشتری توزیع کنید.');
				}
			}
			// --- شاخص‌های جدید ---
			// Consistency: درصد روزهایی که spend بین ۷ تا ۹ ساعت است
			const consistentDays = u.dailySummary.filter(d => d.spent >= 7 * 3600 && d.spent <= 9 * 3600).length;
			const consistencyRatio = u.totalDays > 0 ? consistentDays / u.totalDays : 0;
			// Diversity: تعداد ایشوهای مختلف که کاربر spend داشته
			const diversityCount = Object.values(u.issues).filter(iss => iss.spentInRange > 0).length;
			// Collaboration: تعداد کامنت‌هایی که کاربر روی ایشوهای دیگران گذاشته (نیاز به شمارش جداگانه)
			let collaborationCount = 0;
			if (u.collaborationNotes) collaborationCount = u.collaborationNotes.length;
			// تاثیر در امتیازدهی
			let bonus = 0;
			if (consistencyRatio > 0.7) bonus += 0.05;
			if (diversityCount >= 3) bonus += 0.05;
			if (collaborationCount >= 2) bonus += 0.05;
			// اضافه به totalScore
			u.summary.scores.consistency = Number(consistencyRatio.toFixed(2));
			u.summary.scores.diversity = diversityCount;
			u.summary.scores.collaboration = collaborationCount;
			u.summary.scores.totalScore = Math.min(1, u.summary.scores.totalScore + bonus);
			// پیام راهنما
			if (consistencyRatio > 0.7) u.summary.guidance.push('ثبات خوبی در ثبت spend روزانه دارید.');
			if (diversityCount >= 3) u.summary.guidance.push('روی چند ایشوی مختلف کار کرده‌اید که نشانه تنوع کار است.');
			if (collaborationCount >= 2) u.summary.guidance.push('در همکاری تیمی (کامنت روی ایشوهای دیگران) فعال بوده‌اید.');
		}

		const results = Object.values(usersMap).map(u => ({
			userId: u.userId,
			username: u.username,
			name: u.name,
			avatar_url: u.avatar_url,
			summary: u.summary,
			closedIssuesCount: Object.values(u.issues).filter(iss => iss.state === 'closed').length,
			dailySummary: u.dailySummary,
			estimateDailySummary: u.estimateDailySummary,
			totalEstimate: Array.isArray(u.estimateDailySummary) ? u.estimateDailySummary.reduce((s, e) => s + (e.estimate || 0), 0) : 0,
			issues: Object.values(u.issues).map(iss => ({
				iid: iss.iid,
				title: iss.title,
				state: iss.state,
				labels: iss.labels,
				time_stats: iss.time_stats,
				milestone: iss.milestone,
				created_at: iss.created_at,
				updated_at: iss.updated_at,
				spentInRange: iss.spentInRange,
				estimateInRange: iss.estimateInRange,
				estimateByDate: iss.estimateByDate,
				commentsInRange: iss.commentsInRange,
				quality: iss.quality,
				suspiciousReasons: iss.suspiciousReasons,
			})),
			emptyIssues: u.emptyIssues,
			labels: Array.from(u.labels),
			daysDetail: Array.isArray(u.dailySummary) ? u.dailySummary.map(d => ({ date: d.date, spent: d.spent || 0, absence: (d.spent || 0) === 0 })) : [],
		}));

		await excel(results, users, startKey, endKey);

		res.json(results);
	} catch (error) {
		console.error(error);
		res.status(500).json({
			message: 'خطا در تولید گزارش بازه‌ای فعالیت کاربران',
			error: error?.message || String(error),
		});
	}
};
