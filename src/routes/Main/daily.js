// *** MRB *** //
// #### --> MRB <-- ### //
'use strict';

import { baseUUrl, token, perPage, projectId } from '../../config.js';
import { parseDurationString } from '../../utils.js';

export default async (req, res) => {
  try {
    // allow overriding the single-day target via query param 'date' (YYYY-MM-DD)
    const qDate = req && req.query ? String(req.query.date || '').trim() : '';
    const isYmd = /^\d{4}-\d{2}-\d{2}$/.test(qDate);
    const targetDate = isYmd && !Number.isNaN(Date.parse(qDate)) ? qDate : new Date().toISOString().slice(0, 10);

    let allIssues = [];
    let page = 1;
    while (true) {
      const params = new URLSearchParams();
      params.set('per_page', String(perPage));
      params.set('page', String(page));

      params.set('state', 'opened');

      const url = `${baseUUrl}/projects/${projectId}/issues?${params.toString()}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': token,
        },
      });
      if (!resp.ok) break;
      const batch = await resp.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      allIssues.push(...batch);
      if (batch.length < perPage) break;
      page++;
    }
    console.log('Fetched issues:', allIssues.length);

    const usersMap = {};
    const limit = 5;
    function chunkArray(arr, size) {
      const out = [];
      for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
      }
      return out;
    }
    const issueChunks = chunkArray(allIssues, limit);
    for (const chunk of issueChunks) {
      await Promise.all(
        chunk.map(async issue => {
          if (!issue.iid) return;

          const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
          const legacy = issue.assignee ? [issue.assignee] : [];
          const recipients = assignees.length > 0 ? assignees : legacy;

          const notesResp = await fetch(`${baseUUrl}/projects/${projectId}/issues/${issue.iid}/notes?system=true&per_page=100`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'PRIVATE-TOKEN': token,
            },
          });
          let systemNotes = [];
          if (notesResp.ok) {
            systemNotes = await notesResp.json();
          }

          let hasAnyEventForIssueToday = false;
          const eventsResp = await fetch(`${baseUUrl}/projects/${projectId}/issues/${issue.iid}/resource_time_tracking_events?per_page=100`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'PRIVATE-TOKEN': token,
            },
          });
          if (eventsResp.ok) {
            const events = await eventsResp.json();
            for (const ev of events) {
              const evDate = ev?.created_at ? new Date(ev.created_at).toISOString().slice(0, 10) : null;
              if (evDate !== targetDate) continue;
              const uid = ev?.user?.id;
              if (!uid) continue;
              const isAssignee = recipients.some(p => p && p.id === uid);
              if (!isAssignee) continue;
              const delta = Number(ev.time_spent) || 0;
              if (delta === 0) continue;
              hasAnyEventForIssueToday = true;

              if (!usersMap[uid]) {
                usersMap[uid] = {
                  userId: uid,
                  username: ev.user.username || '',
                  name: ev.user.name || '',
                  avatar_url: ev.user.avatar_url || '',
                  dailySpent: 0,
                  issues: {},
                  labels: new Set(),
                };
              }
              if (!usersMap[uid].issues[issue.iid]) {
                usersMap[uid].issues[issue.iid] = {
                  iid: issue.iid,
                  title: issue.title,
                  labels: issue.labels,
                  time_stats: issue.time_stats,
                  milestone: issue.milestone,
                  created_at: issue.created_at,
                  updated_at: issue.updated_at,
                  dailySpent: 0,
                  commentsToday: 0,
                  activityLogs: [],
                };
                if (Array.isArray(issue.labels)) {
                  issue.labels.forEach(l => usersMap[uid].labels.add(l));
                }
              }
              usersMap[uid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].activityLogs.push({
                type: 'time_spent_changed',
                at: ev.created_at,
                by: uid,
                details: { seconds: delta },
                body: '',
              });
            }
          }

          if (Array.isArray(systemNotes) && systemNotes.length > 0) {
            for (const note of systemNotes) {
              if (!note?.body || !note?.created_at || !note?.author?.id) continue;
              const createdKey = new Date(note.created_at).toISOString().slice(0, 10);
              if (createdKey !== targetDate) continue;
              const uid = note.author.id;
              const isAssignee = recipients.some(p => p && p.id === uid);
              if (!isAssignee) continue;

              const raw = String(note.body);
              
              const labelAddMatch = raw.match(/added ~"(.+?)"/);
              const labelRemoveMatch = raw.match(/removed ~"(.+?)"/);
              if (labelAddMatch) {
                if (!usersMap[uid].issues[issue.iid]) continue;
                usersMap[uid].issues[issue.iid].activityLogs = usersMap[uid].issues[issue.iid].activityLogs || [];
                usersMap[uid].issues[issue.iid].activityLogs.push({
                  type: 'label_added',
                  at: note.created_at,
                  by: uid,
                  details: { label: labelAddMatch[1] },
                  body: raw,
                });
              }
              if (labelRemoveMatch) {
                if (!usersMap[uid].issues[issue.iid]) continue;
                usersMap[uid].issues[issue.iid].activityLogs = usersMap[uid].issues[issue.iid].activityLogs || [];
                usersMap[uid].issues[issue.iid].activityLogs.push({
                  type: 'label_removed',
                  at: note.created_at,
                  by: uid,
                  details: { label: labelRemoveMatch[1] },
                  body: raw,
                });
              }
              

              const m1 = raw.match(/(?:deleted|removed)\s+(.+?)\s+of\s+(?:spent\s+time|time\s+spent)\s+(?:from|on|at)\s+(\d{4}-\d{2}-\d{2})/i);
              if (!m1) continue;
              const duration = m1[1];
              const fromDate = m1[2];
              if (fromDate !== targetDate) continue;

              let seconds = 0;
              //     const unitRe2 = /(\d+)\s*(mo|w|d|h|m|s)\b/gi; // hoisted pattern kept identical for performance
              //     let mm;
              //     while ((mm = unitRe2.exec(duration)) !== null) {
              //       const val = parseInt(mm[1], 10);
              //       const unit = mm[2].toLowerCase();
              //       if (Number.isNaN(val)) continue;
              //       const H = 3600;
              //       const D = 8 * H;
              //       const W = 5 * D;
              //       const MO = 4 * W;
              //       if (unit === 'mo') seconds += val * MO;
              //       else if (unit === 'w') seconds += val * W;
              //       else if (unit === 'd') seconds += val * D;
              //       else if (unit === 'h') seconds += val * H;
              //       else if (unit === 'm') seconds += val * 60;
              //       else if (unit === 's') seconds += val;
              //     }
              seconds = parseDurationString(duration);
              if (seconds === 0) continue;
              const delta = -seconds;

              if (!usersMap[uid]) {
                usersMap[uid] = {
                  userId: uid,
                  username: note.author.username || '',
                  name: note.author.name || '',
                  avatar_url: note.author.avatar_url || '',
                  dailySpent: 0,
                  issues: {},
                  labels: new Set(),
                };
              }
              if (!usersMap[uid].issues[issue.iid]) {
                usersMap[uid].issues[issue.iid] = {
                  iid: issue.iid,
                  title: issue.title,
                  labels: issue.labels,
                  time_stats: issue.time_stats,
                  milestone: issue.milestone,
                  created_at: issue.created_at,
                  updated_at: issue.updated_at,
                  dailySpent: 0,
                  commentsToday: 0,
                  activityLogs: [],
                };
                if (Array.isArray(issue.labels)) {
                  issue.labels.forEach(l => usersMap[uid].labels.add(l));
                }
              }
              usersMap[uid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].activityLogs.push({
                type: 'time_spent_changed',
                at: note.created_at,
                by: uid,
                details: { seconds: delta },
                body: raw,
              });
            }
          }

          if (!hasAnyEventForIssueToday && Array.isArray(systemNotes) && systemNotes.length > 0) {
            for (const note of systemNotes) {
              if (!note?.body || !note?.created_at || !note?.author?.id) continue;
              const noteDate = new Date(note.created_at).toISOString().slice(0, 10);
              if (noteDate !== targetDate) continue;
              const body = String(note.body).toLowerCase();

              // --- handle slash commands removals without explicit amounts ---
              // remove_time_spent: "removed time spent" → zero out all spent for this issue for involved assignees
              if (/\bremoved\s+(?:all\s+)?(?:time\s+spent|spent\s+time)\b/i.test(body)) {
                const assigneesForShare = recipients.filter(p => p && userIdsSet.has(Number(p.id)));
                const shareCount = assigneesForShare.length || 1;
                try {
                  console.log('[activity-range][parse][remove_time_spent]', {
                    iid: issue.iid,
                    at: note.created_at,
                    author: authorId,
                    shareCount,
                    dateKey: noteKey,
                  });
                } catch (e) {}
                for (const person of assigneesForShare) {
                  const uidShare = Number(person.id);
                  if (!usersMap[uidShare]) continue;
                  if (!usersMap[uidShare].issues[issue.iid]) continue;
                  const current = Number(usersMap[uidShare].issues[issue.iid].spentInRange) || 0;
                  if (current === 0) continue;
                  usersMap[uidShare].issues[issue.iid].spentInRange = 0;
                  usersMap[uidShare].totalSpent -= current;
                  usersMap[uidShare].byDate[noteKey] = (usersMap[uidShare].byDate[noteKey] || 0) - current;
                  try {
                    console.log('[activity-range][apply][remove_time_spent]', {
                      userId: uidShare,
                      iid: issue.iid,
                      dateKey: noteKey,
                      delta: -current,
                      totalSpent: usersMap[uidShare].totalSpent,
                    });
                  } catch (e) {}
                }
                continue;
              }

              // remove_estimate: "removed time estimate" → zero out estimate for this issue
              if (/\bremoved\s+(?:time\s+estimate|estimate)\b/i.test(body)) {
                try {
                  if (issue && issue.time_stats) {
                    issue.time_stats.time_estimate = 0;
                  }
                  if (usersMap[authorId] && usersMap[authorId].issues[issue.iid] && usersMap[authorId].issues[issue.iid].time_stats) {
                    usersMap[authorId].issues[issue.iid].time_stats.time_estimate = 0;
                  }

                  console.log('[activity-range][apply][remove_estimate]', { iid: issue.iid, at: note.created_at, author: authorId });
                } catch (e) {}
                // do not continue; other patterns might also apply, but typically it's only estimate removal
              }

              // remove_milestone: "removed milestone" → clear milestone
              if (/\bremoved\s+milestone\b/i.test(body)) {
                try {
                  if (issue) issue.milestone = null;
                  if (usersMap[authorId] && usersMap[authorId].issues[issue.iid]) {
                    usersMap[authorId].issues[issue.iid].milestone = null;
                  }
                  console.log('[activity-range][apply][remove_milestone]', { iid: issue.iid, at: note.created_at, author: authorId });
                } catch (e) {}
                // continue processing others
              }
              const isAdd = body.includes('added') && (body.includes('time spent') || body.includes('spent time'));
              const isSub = (body.includes('subtracted') || body.includes('removed') || body.includes('deleted')) && (body.includes('time spent') || body.includes('spent time'));
              if (!isAdd && !isSub) continue;
              let seconds = 0;
              //     const unitRe = /(\d+)\s*(mo|w|d|h|m|s)\b/gi; // hoisted pattern kept identical for performance
              //     let m;
              
              const addSubMatchA = body.match(/(?:added|subtracted|removed|deleted)\s+(.+?)\s+of\s+(?:time\s+spent|spent\s+time)/i);
              const addSubMatchB = body.match(/(?:added|subtracted|removed|deleted)\s+(?:time\s+spent|spent\s+time)\s+of\s+(.+?)(?:\.|$)/i);
              const parseSource = addSubMatchA ? addSubMatchA[1] : addSubMatchB ? addSubMatchB[1] : body;
              //     while ((m = unitRe.exec(parseSource)) !== null) {
              //       const val = parseInt(m[1], 10);
              //       const unit = m[2].toLowerCase();
              //       if (Number.isNaN(val)) continue;
              //       if (unit === 'mo') seconds += val * MO;
              //       else if (unit === 'w') seconds += val * W;
              //       else if (unit === 'd') seconds += val * D;
              //       else if (unit === 'h') seconds += val * H;
              //       else if (unit === 'm') seconds += val * 60;
              //       else if (unit === 's') seconds += val;
              //     }
              seconds = parseDurationString(parseSource);
              if (seconds === 0) continue;
              const uid = note.author.id;
              const isAssignee = recipients.some(p => p && p.id === uid);
              if (!isAssignee) continue;

              const delta = isSub ? -seconds : seconds;

              if (!usersMap[uid]) {
                usersMap[uid] = {
                  userId: uid,
                  username: note.author.username || '',
                  name: note.author.name || '',
                  avatar_url: note.author.avatar_url || '',
                  dailySpent: 0,
                  issues: {},
                  labels: new Set(),
                };
              }
              if (!usersMap[uid].issues[issue.iid]) {
                usersMap[uid].issues[issue.iid] = {
                  iid: issue.iid,
                  title: issue.title,
                  labels: issue.labels,
                  time_stats: issue.time_stats,
                  milestone: issue.milestone,
                  created_at: issue.created_at,
                  updated_at: issue.updated_at,
                  dailySpent: 0,
                  commentsToday: 0,
                  activityLogs: [],
                };
                if (Array.isArray(issue.labels)) {
                  issue.labels.forEach(l => usersMap[uid].labels.add(l));
                }
              }
              usersMap[uid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].activityLogs.push({
                type: 'time_spent_changed',
                at: note.created_at,
                by: uid,
                details: { seconds: delta },
                body: note.body,
              });
            }
          }

          const commentsResp = await fetch(`${baseUUrl}/projects/${projectId}/issues/${issue.iid}/notes?per_page=100`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'PRIVATE-TOKEN': token,
            },
          });
          if (commentsResp.ok) {
            const comments = await commentsResp.json();
            for (const note of comments) {
              if (note?.system) continue;
              if (!note?.created_at || !note?.author?.id) continue;
              const noteDate = new Date(note.created_at).toISOString().slice(0, 10);
              if (noteDate !== targetDate) continue;
              const uid = note.author.id;
              const isAssignee = recipients.some(p => p && p.id === uid);
              if (!isAssignee) continue;

              if (!usersMap[uid]) {
                usersMap[uid] = {
                  userId: uid,
                  username: note.author.username || '',
                  name: note.author.name || '',
                  avatar_url: note.author.avatar_url || '',
                  dailySpent: 0,
                  issues: {},
                  labels: new Set(),
                };
              }
              if (!usersMap[uid].issues[issue.iid]) {
                usersMap[uid].issues[issue.iid] = {
                  iid: issue.iid,
                  title: issue.title,
                  labels: issue.labels,
                  time_stats: issue.time_stats,
                  milestone: issue.milestone,
                  updated_at: issue.updated_at,
                  dailySpent: 0,
                  commentsToday: 0,
                  activityLogs: [],
                };
                if (Array.isArray(issue.labels)) {
                  issue.labels.forEach(l => usersMap[uid].labels.add(l));
                }
              }
              usersMap[uid].issues[issue.iid].commentsToday += 1;
              const lastEditedAt = note.last_edited_at || note.updated_at;
              const editor = note.last_edited_by || note.editor || note.author;
              if (lastEditedAt) {
                const editDate = new Date(lastEditedAt).toISOString().slice(0, 10);
                if (editDate === targetDate && editor && editor.id === uid && note.created_at !== lastEditedAt) {
                  usersMap[uid].issues[issue.iid].activityLogs.push({
                    type: 'note_edited',
                    at: lastEditedAt,
                    by: uid,
                    details: { id: note.id },
                    body: typeof note.body === 'string' ? note.body.slice(0, 200) : '',
                  });
                }
              }
            }
          }
        })
      );
    }

    for (const issue of allIssues) {
      const updatedDate = issue.updated_at ? new Date(issue.updated_at).toISOString().slice(0, 10) : null;
      if (updatedDate !== targetDate) continue;
      const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
      const legacy = issue.assignee ? [issue.assignee] : [];
      const recipients = assignees.length > 0 ? assignees : legacy;
      for (const person of recipients) {
        if (!person || !person.id) continue;
        const uid = person.id;
        if (!usersMap[uid]) {
          usersMap[uid] = {
            userId: uid,
            username: person.username,
            name: person.name,
            avatar_url: person.avatar_url,
            dailySpent: 0,
            issues: {},
            labels: new Set(),
          };
        }

        if (!usersMap[uid].issues[issue.iid]) {
          usersMap[uid].issues[issue.iid] = {
            iid: issue.iid,
            title: issue.title,
            labels: issue.labels,
            time_stats: issue.time_stats,
            milestone: issue.milestone,
            created_at: issue.created_at,
            updated_at: issue.updated_at,
            dailySpent: usersMap[uid].issues[issue.iid]?.dailySpent || 0,
            commentsToday: usersMap[uid].issues[issue.iid]?.commentsToday || 0,
            activityLogs: usersMap[uid].issues[issue.iid]?.activityLogs || [],
          };
          if (Array.isArray(issue.labels)) {
            issue.labels.forEach(l => usersMap[uid].labels.add(l));
          }
        }
      }
    }
    console.log('Notes and updated issues processed');

    const results = Object.values(usersMap).map(u => ({
      userId: u.userId,
      username: u.username,
      name: u.name,
      avatar_url: u.avatar_url,
      dailySpent: u.dailySpent || 0,
      issues: Object.values(u.issues),
      labels: Array.from(u.labels),
    }));
    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: 'خطا در تولید گزارش روزانه فعالیت کاربران',
      error: error?.message || String(error),
    });
  }
};
// #### --> MRB <-- ### //
// >>> MRB <<< //
