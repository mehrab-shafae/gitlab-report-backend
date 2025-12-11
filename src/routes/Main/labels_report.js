'use strict';

import { baseUUrl, token, perPage } from '../../config.js';
import { resolveProjectIds } from '../../utils.js';

export default async (req, res) => {
    try {
        const { milestone, labels, userId, projectId } = req.query;

        if (!labels) {
            return res.status(400).json({ message: 'حداقل یک لیبل الزامی است' });
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

        const labelList = labels.split(',').map(l => l.trim());
        let projectIds = [];
        try {
            projectIds = await resolveProjectIds(baseUUrl, projectId);
        } catch (e) {
            return res.status(400).json({ message: e?.message || String(e) });
        }

        let allIssues = [];

        for (const pid of projectIds) {
            let page = 1;
            while (true) {
                const params = new URLSearchParams();
                if (milestone) params.append('milestone', milestone);

                let desiredState = (req.query.state || 'opened').toString().toLowerCase();
                if (desiredState === 'open') desiredState = 'opened';
                if (!['opened', 'closed', 'all'].includes(desiredState)) desiredState = 'opened';
                params.set('state', desiredState);
                params.set('per_page', String(perPage));
                params.set('page', String(page));

                const response = await fetch(`${baseUUrl}/projects/${pid}/issues?${params.toString()}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'PRIVATE-TOKEN': token,
                    },
                });

                if (!response.ok) {
                    return res.status(500).json({ message: 'مشکل در گرفتن دیتا از GitLab' });
                }

                const batch = await response.json();
                if (!Array.isArray(batch) || batch.length === 0) break;
                allIssues = allIssues.concat(batch);
                if (batch.length < perPage) break;
                page += 1;
            }
        }

        if (userId && userId !== 'all') {
            allIssues = allIssues.filter(issue => {
                const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
                const inAssignees = assignees.some(a => a && a.id == userId);
                const legacy = issue.assignee && issue.assignee.id == userId;
                return inAssignees || legacy;
            });
        }

        const filteredIssues = allIssues.filter(issue => Array.isArray(issue.labels) && labelList.every(lbl => issue.labels.includes(lbl)));

        const totalSpent = filteredIssues.reduce((sum, issue) => sum + (issue.time_stats?.total_time_spent || 0), 0);
        const issueCount = filteredIssues.length;
        const uniqueUsers = new Set(
            filteredIssues.flatMap(issue => {
                const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
                const legacyAssignee = issue.assignee ? [issue.assignee] : [];
                return [...assignees, ...legacyAssignee].map(a => a?.id).filter(Boolean);
            })
        ).size;
        const avgSpentPerIssue = issueCount > 0 ? (totalSpent / issueCount).toFixed(2) : 0;
        const usersMap = {};
        for (const issue of filteredIssues) {
            const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
            const hasLegacy = !!issue.assignee;
            const recipients = assignees.length > 0 ? assignees : hasLegacy ? [issue.assignee] : [];
            for (const person of recipients) {
                if (!person || !person.id) continue;
                const uid = person.id;
                if (!usersMap[uid]) {
                    usersMap[uid] = {
                        userId: uid,
                        username: person.username,
                        name: person.name,
                        avatar_url: person.avatar_url,
                        issueCount: 0,
                        spentTime: 0,
                        percentWork: 0,
                    };
                }
                usersMap[uid].issueCount += 1;
                usersMap[uid].spentTime += issue.time_stats?.total_time_spent || 0;
            }
        }
        Object.values(usersMap).forEach(user => {
            user.percentWork = totalSpent > 0 ? ((user.spentTime / totalSpent) * 100).toFixed(2) : 0;
        });
        const results = [
            {
                labels: labelList,
                totalSpent,
                issueCount,
                uniqueUsers,
                avgSpentPerIssue,
                users: Object.values(usersMap),
            },
        ];
        res.json(results);
    } catch (error) {
        res.status(500).json({
            message: 'خطا در پردازش دیتا',
            error: error?.message || String(error),
        });
    }
};
