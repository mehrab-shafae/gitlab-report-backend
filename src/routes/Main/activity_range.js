'use strict';

// import excel from './ActivityRange/excel.js';
import I2Func from './ActivityRange/i2.js';
import IssueFunc from './ActivityRange/issue.js';
import SpentFunc from './ActivityRange/spent.js';
import SummaryFunc from './ActivityRange/summary.js';

export default async (req, res) => {
  try {
    const { users, from, to } = req.query;
    // ========================================================================================
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
    // ========================================================================================
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
    // ========================================================================================
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

    // ========================================================================================
    const enumerateWorkingDates = () => {
      const out = [];
      const start = new Date(fromDate);
      const end = new Date(toDate);
      for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
        const key = toKey(d);
        out.push(key);
      }
      return out;
    };
    const workingDateKeys = enumerateWorkingDates();

    // ========================================================================================
    let allIssues = [];
    const usersMap = {};
    // ========================================================================================

    const issueChunks = /* issues */ await IssueFunc(allIssues);

    /* spent */ await SpentFunc(usersMap, issueChunks, userIdsSet, toKey, isInRange, userIds);

    /* misc i2 */ I2Func(allIssues, usersMap, isInRange, toKey, userIds);

    /* summary */ SummaryFunc(req, usersMap, workingDateKeys);

    // ========================================================================================
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

    // ========================================================================================
    // await excel(results, users, startKey, endKey);

    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: 'خطا در تولید گزارش بازه‌ای فعالیت کاربران',
      error: error?.message || String(error),
    });
  }
};
