'use strict';

import { baseUUrl, token, perPage } from '../../config.js';
import { getProjectDisplayNameFromLabel, getStatusDisplayNameFromLabel } from '../../utils.js';

export default async (req, res) => {
  try {
    const { milestone, projectId, userId, workingDays } = req.query;
    const numWorkingDays = Number(workingDays);

    if (!milestone || !projectId) {
      return res.status(400).json({ message: 'milestone و projectId الزامی هستند' });
    }

    // اگر کاربر عادی است، فقط داده‌های خودش را ببیند
    if (!req.auth.isAdmin && req.auth.gitlabUserId) {
      // اگر userId در query مشخص شده و با کاربر فعلی متفاوت است، خطا
      if (userId && userId !== req.auth.gitlabUserId.toString()) {
        return res.status(403).json({ message: 'شما فقط می‌توانید داده‌های خودتان را مشاهده کنید' });
      }
      // اگر userId مشخص نشده، خودکار روی کاربر فعلی تنظیم کن
      if (!userId) {
        req.query.userId = req.auth.gitlabUserId.toString();
      }
    }

    let page = 1;
    let issues = [];
    while (true) {
      const resp = await fetch(`${baseUUrl}/projects/${projectId}/issues?milestone=${encodeURIComponent(milestone)}&state=all&page=${page}&per_page=${perPage}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': token,
        },
      });
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
      const userIssues = issues.filter(issue => {
        const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
        const inAssignees = assignees.some(a => a && a.id == userId);
        const legacy = issue.assignee && issue.assignee.id == userId;
        return inAssignees || legacy;
      });

      let totalSpent = 0;
      let totalEstimate = 0;

      const projectsMap = {};
      for (const issue of userIssues) {
        const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
        const hasLegacy = !!issue.assignee;
        const assigneeCount = assignees.length > 0 ? assignees.length : hasLegacy ? 1 : 0;
        const shareSpent = assigneeCount > 0 ? (issue.time_stats?.total_time_spent || 0) / assigneeCount : 0;
        const shareEstimate = assigneeCount > 0 ? (issue.time_stats?.time_estimate || 0) / assigneeCount : 0;
        totalSpent += shareSpent;
        totalEstimate += shareEstimate;
        const projectLabel = issue.labels.find(l => l.startsWith('Project: '));
        if (!projectLabel) continue;
        const statusLabel = issue.labels.find(l => l.startsWith('Status: '));

        if (!projectsMap[projectLabel]) {
          projectsMap[projectLabel] = {
            projectLabel,
            projectName: getProjectDisplayNameFromLabel(projectLabel),
            totalSpent: 0,
            totalEstimate: 0,
            percentWork: 0,
            status: { statusLabel: '', statusName: '' },
          };
        }

        projectsMap[projectLabel].totalSpent += shareSpent;
        projectsMap[projectLabel].totalEstimate += shareEstimate;
        projectsMap[projectLabel].status = {
          statusLabel,
          statusName: getStatusDisplayNameFromLabel(statusLabel),
        };
      }

      Object.values(projectsMap).forEach(proj => {
        proj.percentWork = totalSpent > 0 ? ((proj.totalSpent / totalSpent) * 100).toFixed(2) : 0;

        proj.performance = numWorkingDays && numWorkingDays > 0 ? ((proj.totalSpent / (numWorkingDays * 8 * 3600)) * 100).toFixed(2) : 0;
      });

      let userInfo = {};
      for (const issue of userIssues) {
        const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
        const found = assignees.find(a => a && a.id == userId);
        if (found) {
          userInfo = found;
          break;
        }
        if (issue.assignee && issue.assignee.id == userId) {
          userInfo = issue.assignee;
          break;
        }
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
        const recipients = assignees.length > 0 ? assignees : hasLegacy ? [issue.assignee] : [];
        if (recipients.length === 0) continue;

        const shareSpent = (issue.time_stats?.total_time_spent || 0) / recipients.length;
        const shareEstimate = (issue.time_stats?.time_estimate || 0) / recipients.length;

        const projectLabel = issue.labels.find(l => l.startsWith('Project: '));
        const statusLabel = issue.labels.find(l => l.startsWith('Status: '));

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
              projectName: getProjectDisplayNameFromLabel(projectLabel),
              totalSpent: 0,
              totalEstimate: 0,
              percentWork: 0,
              issueIds: [],
              status: { statusLabel: '', statusName: '' },
            };
          }

          usersMap[uid].projects[projectLabel].totalSpent += shareSpent;
          usersMap[uid].projects[projectLabel].totalEstimate += shareEstimate;
          usersMap[uid].projects[projectLabel].status = {
            statusLabel,
            statusName: getStatusDisplayNameFromLabel(statusLabel),
          };
          if (issue.iid) {
            usersMap[uid].projects[projectLabel].issueIds.push(issue.iid);
          }
        }
      }

      Object.values(usersMap).forEach(user => {
        Object.values(user.projects).forEach(proj => {
          const toHM = sec => {
            const s = Math.round(Number(sec) || 0);
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            return `${h}h ${m}m`;
          };
          const ids = Array.isArray(proj.issueIds) ? proj.issueIds : [];
          const idsPreview = ids.slice(0, 5).join(',');
          const idsSuffix = ids.length > 5 ? `(+${ids.length - 5} more)` : '';
          console.log(`[time-spends] user="${user.name}" spent=${toHM(user.totalSpent)} estimate=${toHM(user.totalEstimate)} | project="${proj.projectName}" projSpent=${toHM(proj.totalSpent)} | issues=[${idsPreview}] ${idsSuffix}`);
          proj.percentWork = user.totalSpent > 0 ? ((proj.totalSpent / user.totalSpent) * 100).toFixed(2) : 0;

          proj.performance = numWorkingDays && numWorkingDays > 0 ? ((proj.totalSpent / (numWorkingDays * 8 * 3600)) * 100).toFixed(2) : 0;
        });
        user.projects = Object.values(user.projects);
      });

      usersIssues = Object.values(usersMap);
    }

    res.json(usersIssues);
  } catch (error) {
    res.status(500).json({
      message: 'خطا در پردازش دیتا',
      error: error?.message || String(error),
    });
  }
};
