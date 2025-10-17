
import { baseUUrl, token, projectId } from '../../../config.js';
import { parseDurationString } from '../../../utils.js';
import { attribution } from './config.js';

export default async function(usersMap, issueChunks, userIdsSet, toKey, isInRange) {
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
}