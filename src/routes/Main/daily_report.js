// #### --> MRB <-- ### //
'use strict';

import { baseUUrl, token } from '../../config.js';
import { getAllIssuesFromProject, parseDurationString, resolveProjectIds } from '../../utils.js';

export default async (req, res) => {
  try {
    const { projectId = 'all', date } = req.query;

    const targetDate = date || new Date().toISOString().slice(0, 10);

    let projectIds = [];
    try {
      projectIds = await resolveProjectIds(baseUUrl, projectId);
    } catch (e) {
      return res.status(400).json({ message: e?.message || String(e) });
    }

    const parseSpentFromNote = body => {
      if (typeof body !== 'string') return { seconds: 0, forDate: null };
      const lowered = body.toLowerCase();
      //   const unitRe = /(\d+)\s*(mo|w|d|h|m|s)\b/gi;
      //   const H = 3600;
      //   const D = 8 * H;
      //   const W = 5 * D;
      //   const MO = 4 * W;

      const del = lowered.match(/(?:deleted|removed)\s+(.+?)\s+of\s+(?:spent\s+time|time\s+spent)\s+(?:from|on|at)\s+(\d{4}-\d{2}-\d{2})/i);
      if (del) {
        const duration = del[1];
        const forDate = del[2];
        let seconds = 0;
        //     let m;
        //     while ((m = unitRe.exec(duration)) !== null) {
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
        seconds = parseDurationString(duration);
        return { seconds: -seconds, forDate };
      }
      const isAdd = lowered.includes('added') && (lowered.includes('time spent') || lowered.includes('spent time'));
      const isSub = (lowered.includes('subtracted') || lowered.includes('removed') || lowered.includes('deleted')) && (lowered.includes('time spent') || lowered.includes('spent time'));
      if (!isAdd && !isSub) return { seconds: 0, forDate: null };
      let seconds = 0;
      //   let mm;
      
      const addSubMatch = lowered.match(/(?:added|subtracted|removed|deleted)\s+(.+?)\s+of\s+(?:time\s+spent|spent\s+time)/i);
      const parseSource = addSubMatch ? addSubMatch[1] : lowered;
      //   while ((mm = unitRe.exec(parseSource)) !== null) {
      //     const val = parseInt(mm[1], 10);
      //     const unit = mm[2].toLowerCase();
      //     if (Number.isNaN(val)) continue;
      //     if (unit === 'mo') seconds += val * MO;
      //     else if (unit === 'w') seconds += val * W;
      //     else if (unit === 'd') seconds += val * D;
      //     else if (unit === 'h') seconds += val * H;
      //     else if (unit === 'm') seconds += val * 60;
      //     else if (unit === 's') seconds += val;
      //   }
      seconds = parseDurationString(parseSource);
      return { seconds: isSub ? -seconds : seconds, forDate: null };
    };

    const usersMap = {};

    for (const pid of projectIds) {
      const issues = await getAllIssuesFromProject(baseUUrl, pid, '');

      for (const issue of issues) {
        const issueIid = issue.iid;
        if (!issueIid) continue;

        const notesResp = await fetch(`${baseUUrl}/projects/${pid}/issues/${issueIid}/notes?system=true&per_page=100`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'PRIVATE-TOKEN': token,
          },
        });
        if (!notesResp.ok) continue;
        const notes = await notesResp.json();

        for (const note of notes) {
          const createdAt = note.created_at;
          if (!createdAt || !note.body) continue;
          const noteDate = new Date(createdAt).toISOString().slice(0, 10);

          const { seconds: deltaSeconds, forDate } = parseSpentFromNote(note.body);
          if (deltaSeconds === 0) continue;

          const targetKey = forDate || noteDate;
          if (targetKey !== targetDate) continue;

          
          const assignees = Array.isArray(issue.assignees) ? issue.assignees : issue.assignee ? [issue.assignee] : [];
          const shareTargets = assignees.length > 0 ? assignees : [note.author];
          const shareCount = shareTargets.length;
          const shareSeconds = deltaSeconds / shareCount;
          for (const person of shareTargets) {
            if (!person || !person.id) continue;
            const uid = person.id;
            if (!usersMap[uid]) {
              usersMap[uid] = {
                userId: uid,
                username: person.username || '',
                name: person.name || '',
                avatar_url: person.avatar_url || '',
                dailySpent: 0,
              };
            }
            usersMap[uid].dailySpent += shareSeconds;
          }
        }
      }
    }

    const results = Object.values(usersMap).map(u => ({
      userId: u.userId,
      username: u.username,
      name: u.name,
      avatar_url: u.avatar_url,
      dailySpent: u.dailySpent,
    }));

    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: 'خطا در تولید گزارش روزانه',
      error: error?.message || String(error),
    });
  }
};
// #### --> MRB <-- ### //
// *** MRB *** //
