'use strict';

import { baseUUrl, token, projectId } from '../../../config.js';
import { parseDurationString } from '../../../utils.js';
import { attribution } from './config.js';

// Helper function to check if a user note contains GitLab commands that should be ignored
function containsGitLabCommands(note) {
	if (!note?.body) return false;

	const body = String(note.body).toLowerCase();

	// Check for GitLab slash commands
	const slashCommands = ['/spend', '/remove_time_spent', '/remove_estimate', '/remove_milestone', '/estimate', '/time_estimate', '/milestone', '/label', '/assign', '/unassign', '/close', '/reopen', '/todo', '/done'];

	// Check if body contains any slash commands
	for (const command of slashCommands) {
		if (body.includes(command)) return true;
	}

	// Check for time-related patterns that might be commands
	const timePatterns = [/\bspend\s+\d+[hdm]\b/i, /\bremove\s+time\s+spent\b/i, /\badd\s+\d+[hdm]\b/i, /\bestimate\s+\d+[hdm]\b/i];

	for (const pattern of timePatterns) {
		if (pattern.test(body)) return true;
	}

	return false;
}

// Helper function to check if a note is a valid system note for time tracking
function isValidSystemNote(note) {
	if (!note?.body || !note?.author?.id) return false;

	const body = String(note.body).toLowerCase();

	// Check if it's a system note by looking for system patterns
	const isSystemPattern =
		(body.includes('added') && (body.includes('time spent') || body.includes('spent time'))) ||
		(body.includes('subtracted') && (body.includes('time spent') || body.includes('spent time'))) ||
		(body.includes('removed') && (body.includes('time spent') || body.includes('spent time'))) ||
		(body.includes('deleted') && (body.includes('time spent') || body.includes('spent time'))) ||
		(body.includes('changed') && body.includes('time estimate')) ||
		(body.includes('added') && body.includes('time estimate')) ||
		(body.includes('removed') && body.includes('time estimate'));

	// Additional check: system notes usually have specific patterns
	const hasTimePattern = /\b\d+[hdm]\b|\b\d+\s*(hour|day|minute|week)s?\b/i.test(body);

	// Additional check: system notes usually don't contain user-specific content
	const hasUserContent = body.includes('comment') || body.includes('note') || body.includes('update') || body.includes('status') || body.includes('progress') || body.length > 200; // System notes are usually short

	return isSystemPattern && hasTimePattern && !hasUserContent;
}

// Helper function to parse date from note body
function parseDateFromBody(body, noteCreatedAt, toKey) {
	const bodyLower = String(body).toLowerCase();

	// Handle "just now"
	if (bodyLower.includes('just now')) {
		return toKey(noteCreatedAt);
	}

	// Handle "X time ago" patterns
	const agoMatch = bodyLower.match(/(\d+)\s+(week|day|hour|minute)s?\s+ago/i);
	if (agoMatch) {
		const amount = parseInt(agoMatch[1]);
		const unit = agoMatch[2].toLowerCase();
		const date = new Date(noteCreatedAt);

		if (unit === 'week') {
			date.setDate(date.getDate() - amount * 7);
		} else if (unit === 'day') {
			date.setDate(date.getDate() - amount);
		} else if (unit === 'hour') {
			date.setHours(date.getHours() - amount);
		} else if (unit === 'minute') {
			date.setMinutes(date.getMinutes() - amount);
		}

		return toKey(date);
	}

	// Handle explicit dates (existing logic)
	const mIso = bodyLower.match(/(?:\b(?:from|on|at)\s+)?(\d{4}-\d{2}-\d{2})\b/);
	const mSlash = !mIso && bodyLower.match(/(?:\b(?:from|on|at)\s+)?(\d{4}\/\d{2}\/\d{2})\b/);
	const mMon = !mIso && !mSlash && bodyLower.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2}),\s*(\d{4})\b/i);

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

	return normalized || toKey(noteCreatedAt);
}

export default async function (usersMap, issueChunks, userIdsSet, toKey, isInRange, userIds) {
	for (const chunk of issueChunks) {
		await Promise.allSettled(
			// ========================================================================================
			chunk.map(async issue => {
				if (!issue?.iid) return;
				const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
				const legacy = issue.assignee ? [issue.assignee] : [];
				const recipients = assignees.length > 0 ? assignees : legacy;

				const targetAssignees = recipients.filter(p => p && userIdsSet.has(Number(p.id)));
				if (targetAssignees.length === 0) return;

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
				// ========================================================================================
				const [sysNotes, userNotes] = await Promise.all([fetchAllNotes(true), fetchAllNotes(false)]);

				if (Array.isArray(sysNotes)) {
					const notes = [...sysNotes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
					// ========================================================================================
					for (const note of notes) {
						if (!note?.body || !note?.created_at || !note?.author?.id) continue;

						// Only process valid system notes for time tracking
						if (!isValidSystemNote(note)) {
							// Log skipped notes for debugging
							// console.log(`Skipped system note: ${note.body?.substring(0, 100)}...`);
							continue;
						}

						const authorId = Number(note.author.id);
						const body = String(note.body);

						// Use improved date parsing
						const targetKey = parseDateFromBody(body, note.created_at, toKey);
						if (!isInRange(targetKey)) continue;

						if (/\bremoved\s+(?:all\s+)?(?:time\s+spent|spent\s+time)\b/i.test(body)) {
							const assigneesForShare = recipients.filter(p => p && userIdsSet.has(Number(p.id)));

							for (const person of assigneesForShare) {
								const uidShare = Number(person.id);
								const uRec = usersMap[uidShare];
								if (!uRec) continue;
								const issRec = uRec.issues && uRec.issues[issue.iid];
								if (!issRec) continue;

								// Remove all time spent for this issue
								const currentTotal = Number(issRec.spentInRange) || 0;
								if (currentTotal > 0) {
									// Subtract per-day amounts tracked on the issue
									const perDay = issRec.byDate || {};
									for (const [dkey, val] of Object.entries(perDay)) {
										if (typeof val === 'number' && val !== 0) {
											uRec.byDate[dkey] = (uRec.byDate[dkey] || 0) - val;
										}
									}

									// Reset issue totals
									uRec.totalSpent -= currentTotal;
									issRec.spentInRange = 0;
									issRec.byDate = {};
								}
							}
							continue;
						}

						// ========================================================================================
						const delMatch = body.match(/(?:deleted|removed)\s+(.+?)\s+of\s+(?:spent\s+time|time\s+spent)\s+(?:from|on|at)\s+(\d{4}-\d{2}-\d{2})/i);
						if (delMatch) {
							const duration = delMatch[1];
							const fromDateKey = delMatch[2];

							if (!isInRange(fromDateKey)) continue;
							let seconds = 0;
							seconds = parseDurationString(duration);
							seconds = Math.abs(seconds);
							if (seconds === 0) continue;

							let assigneesForShare = recipients;
							let baseCount = assigneesForShare.length || 1;
							let shareSeconds = seconds / baseCount;
							if (attribution === 'author') {
								assigneesForShare = [{ id: authorId, username: note.author.username, name: note.author.name, avatar_url: note.author.avatar_url }];
								baseCount = 1;
								shareSeconds = seconds;
							}

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
							}
							continue;
						}

						// Use improved date parsing for add/subtract operations
						const targetDate = parseDateFromBody(body, note.created_at, toKey);
						if (!isInRange(targetDate)) continue;

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

						let assigneesForShare = recipients;
						let baseCount = assigneesForShare.length || 1;
						const delta = isSub ? -seconds : seconds;
						let shareSeconds = delta / baseCount;
						if (attribution === 'author') {
							assigneesForShare = [{ id: authorId, username: note.author.username, name: note.author.name, avatar_url: note.author.avatar_url }];
							baseCount = 1;
							shareSeconds = delta;
						}

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
								const currentIssueDay = Number(usersMap[uidShare].issues[issue.iid].byDate[targetDate] || 0);
								const appliedAbs = Math.min(currentIssueDay, Math.abs(shareSeconds));
								if (appliedAbs <= 0) continue;
								appliedDelta = -appliedAbs;
							}

							// Apply time changes to the correct date
							usersMap[uidShare].totalSpent += appliedDelta;
							usersMap[uidShare].issues[issue.iid].spentInRange = Math.max(0, (usersMap[uidShare].issues[issue.iid].spentInRange || 0) + appliedDelta);
							usersMap[uidShare].byDate[targetDate] = Math.max(0, (usersMap[uidShare].byDate[targetDate] || 0) + appliedDelta);
							usersMap[uidShare].issues[issue.iid].byDate[targetDate] = Math.max(0, (usersMap[uidShare].issues[issue.iid].byDate[targetDate] || 0) + appliedDelta);

							// Track large one-off spends
							if (isAdd && Math.abs(appliedDelta) >= 8 * 3600) {
								usersMap[uidShare].issues[issue.iid].quality.largeOneOffSpends.push({
									at: note.created_at,
									seconds: appliedDelta,
									dateKey: targetDate,
								});
							}

							if (isAdd && delta > 0) {
								if (!Array.isArray(usersMap[uidShare].spendAddLog)) usersMap[uidShare].spendAddLog = [];
								usersMap[uidShare].spendAddLog.push({
									at: note.created_at,
									seconds: shareSeconds,
									issue_iid: issue.iid,
								});
							}
						}
						// ========================================================================================
						{
							const noteKey = toKey(note.created_at);
							const body = String(note.body).toLowerCase();
							const authorId = Number(note.author.id);
							if (/\bremoved\s+(?:all\s+)?(?:time\s+estimate|estimate\s+time)\b/i.test(body)) {
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
									const assigneesCount = attribution === 'author' ? 1 : recipients.length || 1;
									const share = assigneesCount > 0 ? deltaSet / assigneesCount : deltaSet;
									usersMap[uid].totalEstimate = (usersMap[uid].totalEstimate || 0) + share;
									issRec.estimateInRange = (issRec.estimateInRange || 0) + share;
									issRec.estimateByDate[noteKey] = (issRec.estimateByDate[noteKey] || 0) + share;
								}
							} else {
								const added = body.includes('added') && body.includes('time estimate');
								const removed = (body.includes('subtracted') || body.includes('removed') || body.includes('deleted')) && body.includes('time estimate');
								const changedMatch = body.match(/changed\s+time\s+estimate\s+to\s+(.+?)(?:\.|$)/i);
								if (!(added || removed || changedMatch)) {
								} else {
									let desiredDelta = 0;
									if (changedMatch) {
										let seconds = 0;
										const src = changedMatch[1];
										seconds = parseDurationString(src);
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
									let assigneesForShare = recipients;
									if (attribution === 'author') {
										assigneesForShare = [{ id: authorId, username: note.author.username, name: note.author.name, avatar_url: note.author.avatar_url }];
									}
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
				// ========================================================================================
				if (Array.isArray(userNotes)) {
					const notes = [...userNotes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

					for (const note of notes) {
						if (note?.system) continue;
						if (!note?.created_at || !note?.author?.id) continue;
						const authorId = Number(note.author.id);
						if (!userIds.includes(authorId)) continue;

						// Skip notes that contain GitLab commands (these are handled by system notes)
						if (containsGitLabCommands(note)) {
							// Log skipped notes for debugging
							// console.log(`Skipped user note with GitLab commands: ${note.body?.substring(0, 100)}...`);
							continue;
						}

						// Use improved date parsing for user notes
						const noteKey = parseDateFromBody(note.body, note.created_at, toKey);
						if (!isInRange(noteKey)) continue;

						const isAssignee = recipients.some(p => p && Number(p.id) === authorId);
						if (!isAssignee) {
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
}
