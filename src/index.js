import 'dotenv/config';
import ExcelJS from 'exceljs';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import cors from 'cors';

const app = express();

const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
mongoose
  .connect(mongoUri, {
    dbName: process.env.MONGODB_DB || 'forvest_git',
    authSource: 'admin',
    socketTimeoutMS: 60000,
    serverSelectionTimeoutMS: 60000,
    minPoolSize: 5,
    maxPoolSize: 20,
  })
  .then(() => console.log('* MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err.message));

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

const ALL_PROJECT_IDS = [];
// const projectNameCache = {};

const baseUUrl = process.env.GITLAB_BASE_URL;
const token = process.env.GITLAB_TOKEN;
const projectId = process.env.GITLAB_PROJECT_ID;
const groupId = process.env.GITLAB_GROUP_ID;
const port = process.env.PORT || 3000;
const perPage = 100; //, 50, 100
const adminUser = process.env.adminUser || 'master';
const JWT_SECRET = process.env.JWT_SECRET || 'fdffdsasd4343';
const DEV_MODE = process.env.DEV_MODE === 'true';

if (DEV_MODE) {
  console.log('🔧 Development mode is ENABLED - Token validation bypassed');
}

const originsC = ['http://localhost:3000', 'http://localhost:3001', process.env.originsCors];

if (!baseUUrl || !token) {
  throw new Error('GITLAB_BASE_URL یا GITLAB_TOKEN ست نشده است');
}
if (!projectId) {
  throw new Error('projectId مشخص نیست (query یا .env)');
}

(function main() {
  app.use(
    cors({
      origin: originsC,
      credentials: true,
    })
  );

  app.use(express.json());

  masterOAuth();
  master1();

  app.listen(port, () => {
    console.log(`* Server listening on port ${port}`);
  });
})();

function masterOAuth() {
  app.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ message: 'username و password الزامی هستند' });
      }

      const user = await User.findOne({ username, password }).lean();
      if (!user) {
        return res.status(401).json({
          status: 'error',
          message: 'نام کاربری یا رمز عبور اشتباه است',
        });
      }

      const payload = {
        sub: String(user._id),
        username: user.username,
        isAdmin: Boolean(user.isAdmin) && user.username === adminUser,
      };
      const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

      return res.json({ status: 'ok', message: 'ورود موفق بود', accessToken, user: payload });
    } catch (error) {
      return res.status(500).json({
        message: 'خطا در بررسی ورود',
        error: error?.message || String(error),
      });
    }
  });

  app.post('/register', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ message: 'username و password الزامی هستند' });
      }

      const exists = await User.exists({ username });
      if (exists) {
        return res.status(409).json({ message: 'این نام کاربری قبلاً ثبت شده است' });
      }

      let created;

      if (username === adminUser) {
        created = await User.create({ username, password, isAdmin: true });
      } else {
        created = await User.create({ username, password });
      }

      return res.status(201).json({ status: 'ok', id: created._id });
    } catch (error) {
      return res.status(500).json({
        message: 'خطا در ثبت کاربر',
        error: error?.message || String(error),
      });
    }
  });
}

function master1() {
  app.use(async (req, res, next) => {
    try {
      if (DEV_MODE) {
        req.auth = { isAdmin: true, username: adminUser };
        return next();
      }

      const authHeader = req.headers['authorization'] || '';
      const tokenStr = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.headers['x-access-token'] || '').toString();

      if (!tokenStr) {
        return res.status(401).json({ message: 'توکن ارائه نشده است' });
      }

      let claims;
      try {
        claims = jwt.verify(tokenStr, JWT_SECRET);
      } catch (e) {
        return res.status(401).json({ message: 'توکن نامعتبر است' });
      }

      const isAdmin = Boolean(claims?.isAdmin) && claims?.username === adminUser;

      if (!isAdmin) {
        if (!claims?.username) {
          return res.status(403).json({ message: 'کاربر در توکن مشخص نیست' });
        }

        let users;
        try {
          users = await fetchGitlabUsers();
        } catch (err) {
          return res.status(502).json({ message: 'خطا در دریافت کاربران GitLab' });
        }

        const matched = users.find(u => String(u?.username).toLowerCase() === String(claims.username).toLowerCase());
        if (!matched) {
          return res.status(403).json({ message: 'یوزر اشتباه است یا در GitLab یافت نشد' });
        }

        // Enforce self-access by userId in query for enforced routes
        const selfId = String(matched.id);

        // Reject attempts to impersonate via query/params/body
        const qUserId = req.query?.userId ? String(req.query.userId) : undefined;
        const pId = req.params?.id ? String(req.params.id) : undefined;
        const bUserId = req.body?.userId ? String(req.body.userId) : undefined;

        if ((qUserId && qUserId !== selfId) || (pId && pId !== selfId) || (bUserId && bUserId !== selfId)) {
          return res.status(403).json({ message: 'به داده‌های سایر کاربران دسترسی ندارید' });
        }

        // Auto-scope if userId not present
        if (!qUserId) {
          req.query.userId = selfId;
        }
        if (req.body && !bUserId) {
          req.body.userId = selfId;
        }

        req.auth = { isAdmin: false, username: claims.username, gitlabUserId: matched.id };
      } else {
        req.auth = { isAdmin: true, username: claims.username };
      }

      return next();
    } catch (err) {
      return res.status(500).json({ message: 'خطای داخلی در احراز هویت', error: err?.message || String(err) });
    }
  });

  app.get('/milestones', async (req, res) => {
    try {
      const response = await fetch(`${baseUUrl}/projects/${projectId}/milestones`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'PRIVATE-TOKEN': token,
        },
      });

      if (!response.ok) {
        return res.json({
          status: 'err',
        });
      }

      const data = await response.json();
      res.json({
        data: data,
      });
    } catch (error) {
      console.log(45);
      res.status(500).json({
        message: 'Failed to fetch milestones report',
        error: error?.message || String(error),
      });
    }
  });

  app.get('/Users', async (req, res) => {
    const response = await fetch(`${baseUUrl}/users`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': token,
      },
    });

    const data = await response.json();
    console.log(data);

    const activeUser = data.filter(user => {
      if (user.state) {
        return true;
      } else {
        return false;
      }
    });

    res.json({
      status: 'success',
      data: activeUser,
    });
  });
  app.get('/labels', async (req, res) => {
    try {
      let andLabels = [];
      if (req.query.labels) {
        if (Array.isArray(req.query.labels)) {
          andLabels = req.query.labels;
        } else if (typeof req.query.labels === 'string') {
          andLabels = req.query.labels
            .split(',')
            .map(l => l.trim())
            .filter(Boolean);
        }
      }

      const params = new URLSearchParams({
        per_page: '100',
        with_counts: (req.query.with_counts ?? 'true').toString(),
        include_ancestor_groups: (req.query.include_ancestor_groups ?? 'true').toString(),
      });
      if (req.query.search) params.set('search', String(req.query.search));

      let page = 1;
      const allLabels = [];
      while (true) {
        params.set('page', String(page));
        const url = `${baseUUrl}/projects/${encodeURIComponent(projectId)}/labels?${params.toString()}`;

        const r = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'PRIVATE-TOKEN': token,
          },
        });

        if (!r.ok) {
          return res.status(r.status).json({ status: 'err', message: `GitLab responded ${r.status}` });
        }

        const chunk = await r.json();
        allLabels.push(...chunk);

        const nextPageHeader = r.headers.get('x-next-page');
        if (!nextPageHeader || nextPageHeader === '0' || chunk.length < perPage) break;

        page = parseInt(nextPageHeader, 10) || page + 1;
      }

      if (andLabels.length > 0) {
        let issues = [];
        let issuePage = 1;
        while (true) {
          const issueParams = new URLSearchParams({
            per_page: String(perPage),
            page: String(issuePage),
            state: 'all',
          });
          const issuesUrl = `${baseUUrl}/projects/${encodeURIComponent(projectId)}/issues?${issueParams.toString()}`;
          const issuesResp = await fetch(issuesUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'PRIVATE-TOKEN': token,
            },
          });
          if (!issuesResp.ok) break;
          const issuesChunk = await issuesResp.json();
          if (!Array.isArray(issuesChunk) || issuesChunk.length === 0) break;
          issues.push(...issuesChunk);
          if (issuesChunk.length < perPage) break;
          issuePage++;
        }

        const labelSet = new Set();
        for (const issue of issues) {
          if (!Array.isArray(issue.labels)) continue;

          if (andLabels.every(l => issue.labels.includes(l))) {
            for (const l of issue.labels) {
              labelSet.add(l);
            }
          }
        }

        const filteredLabels = allLabels.filter(lbl => labelSet.has(lbl.name));
        return res.json({ status: 'success', data: filteredLabels });
      }

      res.json({ status: 'success', data: allLabels });
    } catch (e) {
      res.status(500).json({
        message: 'Failed to fetch labels',
        error: e?.message || String(e),
      });
    }
  });

  app.get('/time-spends', async (req, res) => {
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
  });

  app.get('/milestone-daily-spends', async (req, res) => {
    try {
      const { projectId = 'all', milestone } = req.query;

      if (!milestone) {
        return res.status(400).json({ message: 'milestone الزامی است' });
      }

      const parseSpentFromNote = body => {
        if (typeof body !== 'string') return { seconds: 0, forDate: null };
        const lowered = body.toLowerCase();
        // support deleted/removed, and both "spent time" and "time spent", with optional date keywords
        const del = lowered.match(/(?:deleted|removed)\s+(.+?)\s+of\s+(?:spent\s+time|time\s+spent)\s+(?:from|on|at)\s+(\d{4}-\d{2}-\d{2})/i);
      //   const unitRe = /(\d+)\s*(mo|w|d|h|m|s)\b/gi;
      //   const H = 3600;
      //   const D = 8 * H;
      //   const W = 5 * D;
      //   const MO = 4 * W;
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
        // استخراج duration دقیق پس از added/subtracted/removed/deleted و هر دو ترتیب عبارت
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
        if (seconds === 0) return { seconds: 0, forDate: null };
        return { seconds: isSub ? -seconds : seconds, forDate: null };
      };

      let projectIds = [];
      try {
        projectIds = await resolveProjectIds(baseUUrl, projectId);
      } catch (e) {
        return res.status(400).json({ message: e?.message || String(e) });
      }

      const usersMap = {};

      for (const pid of projectIds) {
        const issues = await getAllIssuesFromProject(baseUUrl, pid, milestone);

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
            if (!note?.body || !note?.created_at || !note?.author?.id) continue;
            const { seconds: deltaSeconds, forDate } = parseSpentFromNote(note.body);
            if (deltaSeconds === 0) continue;

            const dateKey = forDate || new Date(note.created_at).toISOString().slice(0, 10);
            // توزیع spend بین assigneeهای issue؛ در صورت نبود، نسبت به author
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
                  byDate: {},
                };
              }
              usersMap[uid].byDate[dateKey] = (usersMap[uid].byDate[dateKey] || 0) + shareSeconds;
            }
          }
        }
      }

      const monthMatch = String(milestone).match(/(\d{4})-(\d{2})/);
      const targetYear = monthMatch ? parseInt(monthMatch[1], 10) : new Date().getUTCFullYear();
      const targetMonthNum = monthMatch ? parseInt(monthMatch[2], 10) : new Date().getUTCMonth() + 1;
      const monthIndex = targetMonthNum - 1;
      const daysInMonth = new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate();

      const monthDates = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(Date.UTC(targetYear, monthIndex, day)).toISOString().slice(0, 10);
        monthDates.push(d);
      }

      const results = Object.values(usersMap).map(u => ({
        userId: u.userId,
        username: u.username,
        name: u.name,
        avatar_url: u.avatar_url,
        spend: monthDates.map(d => ({ date: d, spent: u.byDate[d] || 0 })),
      }));

      res.json(results);
    } catch (error) {
      res.status(500).json({
        message: 'خطا در تولید گزارش روزانه مایل‌استون',
        error: error?.message || String(error),
      });
    }
  });

  app.get('/labels-report', async (req, res) => {
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
  });

  app.get('/daily-report', async (req, res) => {
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
        // استخراج duration دقیق پس از added/subtracted/removed/deleted و هر دو ترتیب عبارت
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

            // توزیع بین assigneeها؛ اگر نداشت، روی author
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
  });

  app.get('/daily', async (req, res) => {
    try {
      const targetDate = new Date().toISOString().slice(0, 10);

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
                // --- ثبت تغییرات لیبل ---
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
                // --- پایان ثبت تغییرات لیبل ---

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
                // تلاش برای استخراج duration دقیق پس از added/subtracted/removed/deleted و هر دو ترتیب عبارت
                const addSubMatch = body.match(/(?:added|subtracted|removed|deleted)\s+(.+?)\s+of\s+(?:time\s+spent|spent\s+time)/i);
                const parseSource = addSubMatch ? addSubMatch[1] : body;
            //     while ((m = unitRe.exec(parseSource)) !== null) {
            //       const val = parseInt(m[1], 10);
            //       const unit = m[2].toLowerCase();
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
  });

  app.get('/activity-range', async (req, res) => {
    // --- تعریف وزن‌های امتیازدهی (قابل پیکربندی از query/env) ---
    const wRealness = Number(req.query.w_realness ?? process.env.W_REALNESS ?? 0.5);
    const wQuality = Number(req.query.w_quality ?? process.env.W_QUALITY ?? 0.3);
    const wAbsence = Number(req.query.w_absence ?? process.env.W_ABSENCE ?? 0.2);
    const weights = {
      realness: Number.isFinite(wRealness) ? wRealness : 0.5,
      quality: Number.isFinite(wQuality) ? wQuality : 0.3,
      absence: Number.isFinite(wAbsence) ? wAbsence : 0.2,
    };
    try {
      const { users, from, to } = req.query;
      const attribution = (req.query.attribution || 'shared').toString().toLowerCase(); // 'author' | 'shared'
      const NOTES_CONCURRENCY = Math.max(1, Number(process.env.ACTIVITY_NOTES_CONCURRENCY) || 10);

      if (!users || !from || !to) {
        return res.status(400).json({ message: 'پارامترهای users, from, to الزامی هستند' });
      }

      // اگر کاربر عادی است، فقط داده‌های خودش را ببیند
      if (!req.auth.isAdmin && req.auth.gitlabUserId) {
        const currentUserId = req.auth.gitlabUserId;
        // اگر users شامل userId های دیگری است، خطا
        const requestedUserIds = String(users)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .map(s => Number(s))
          .filter(n => !Number.isNaN(n));

        if (requestedUserIds.length > 0 && !requestedUserIds.includes(currentUserId)) {
          return res.status(403).json({ message: 'شما فقط می‌توانید داده‌های خودتان را مشاهده کنید' });
        }

        // اگر users مشخص نشده یا شامل userId فعلی نیست، خودکار تنظیم کن
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
      // timezone offset in minutes; positive => add minutes to UTC
      const tzOffsetMinutes = Number(req.query.tz_offset_minutes ?? process.env.TZ_OFFSET_MINUTES ?? 0);
      const toKey = d => {
        const base = d instanceof Date ? d : new Date(d);
        const adjMs = base.getTime() + (Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0) * 60000;
        const adj = new Date(adjMs);
        return `${adj.getUTCFullYear()}-${pad2(adj.getUTCMonth() + 1)}-${pad2(adj.getUTCDate())}`;
      };
      const startKey = toKey(fromDate);
      const endKey = toKey(toDate);
      const isInRange = isoDate => isoDate >= startKey && isoDate <= endKey;
      // --- configurable working days ---
      const parseWorkdays = input => {
        // Accept: comma-separated of numbers 0..6 (Sun..Sat) or names mon,tue,...
        const nameToNum = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
        if (!input) return new Set([1, 2, 3, 4, 5]); // default Mon-Fri
        const parts = String(input)
          .split(',')
          .map(s => s.trim().toLowerCase())
          .filter(Boolean);
        const out = new Set();
        for (const p of parts) {
          if (/^\d+$/.test(p)) {
            const n = Number(p);
            if (n >= 0 && n <= 6) out.add(n);
          } else if (nameToNum.hasOwnProperty(p)) {
            out.add(nameToNum[p]);
          }
        }
        return out.size > 0 ? out : new Set([1, 2, 3, 4, 5]);
      };
      // Only from env; default to Sunday-Thursday (0..4)
      const workdaysParam = process.env.WORKDAYS; // e.g., "sun,mon,tue,wed,thu" or "0,1,2,3,4"
      const workdaysSet = parseWorkdays(workdaysParam || 'sun,mon,tue,wed,thu');
      // Build working-day calendar (Saturday to Thursday), respecting tz_offset
      const enumerateWorkingDates = () => {
        const out = [];
        const start = new Date(fromDate);
        const end = new Date(toDate);
        // iterate inclusive
        for (let d = new Date(start); d.getTime() <= end.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
          const key = toKey(d);
          // determine weekday on adjusted date
          const adjMs = d.getTime() + (Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : 0) * 60000;
          const adj = new Date(adjMs);
          const weekday = adj.getUTCDay(); // 0..6 (Sun..Sat)
          if (workdaysSet.has(weekday)) out.push(key);
        }
        return out;
      };
      const workingDateKeys = enumerateWorkingDates();

      let allIssues = [];
      {
        const params = new URLSearchParams();
        params.set('per_page', String(perPage));
        params.set('page', '1');
        params.set('state', 'all');
        const firstUrl = `${baseUUrl}/projects/${projectId}/issues?${params.toString()}`;
        const firstResp = await fetch(firstUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'PRIVATE-TOKEN': token,
            Connection: 'keep-alive',
          },
        });
        if (!firstResp.ok) {
          return res.status(500).json({ message: 'مشکل در گرفتن دیتا از GitLab' });
        }
        const firstBatch = await firstResp.json();
        if (Array.isArray(firstBatch) && firstBatch.length > 0) {
          allIssues.push(...firstBatch);
        }
        const totalPagesHeader = firstResp.headers.get('x-total-pages');
        const totalPages = totalPagesHeader ? parseInt(totalPagesHeader, 10) : null;
        if (totalPages && totalPages > 1) {
          const pageNumbers = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
          const pageResults = await Promise.all(
            pageNumbers.map(async p => {
              const pParams = new URLSearchParams();
              pParams.set('per_page', String(perPage));
              pParams.set('page', String(p));
              pParams.set('state', 'all');
              const url = `${baseUUrl}/projects/${projectId}/issues?${pParams.toString()}`;
              const r = await fetch(url, {
                method: 'GET',
                headers: {
                  'Content-Type': 'application/json',
                  'PRIVATE-TOKEN': token,
                  Connection: 'keep-alive',
                },
              });
              if (!r.ok) return [];
              const chunk = await r.json();
              return Array.isArray(chunk) ? chunk : [];
            })
          );
          for (const arr of pageResults) allIssues.push(...arr);
        } else {
          let page = 2;
          while (true) {
            const params2 = new URLSearchParams();
            params2.set('per_page', String(perPage));
            params2.set('page', String(page));
            params2.set('state', 'all');
            const url = `${baseUUrl}/projects/${projectId}/issues?${params2.toString()}`;
            const resp = await fetch(url, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'PRIVATE-TOKEN': token,
                Connection: 'keep-alive',
              },
            });
            if (!resp.ok) break;
            const batch = await resp.json();
            if (!Array.isArray(batch) || batch.length === 0) break;
            allIssues.push(...batch);
            if (batch.length < perPage) break;
            page++;
          }
        }
      }

      try {
        console.log('[activity-range][pre] users:', userIds.join(','), 'range:', startKey, 'to', endKey);
        console.log('[activity-range][pre] fetched issues count:', allIssues.length);
        const sampleIssueIds = allIssues
          .slice(0, 10)
          .map(it => it && it.iid)
          .filter(Boolean);
        console.log('[activity-range][pre] sample issue IIDs:', sampleIssueIds.join(', '));
      } catch (e) {}

      const usersMap = {};
      const limit = Math.max(1, NOTES_CONCURRENCY);
      const chunkArray = (arr, size) => {
        const out = [];
        for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
        return out;
      };
      const issueChunks = chunkArray(allIssues, limit);

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
                const noteKey = toKey(note.created_at);
                const authorId = Number(note.author.id);
                const body = String(note.body).toLowerCase();

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
                  // const unitRe2 = /(-?\d+)\s*(mo|w|d|h|m|s)\b/gi;
                  // let m;
                  // const H = 3600;
                  // const D = 8 * H;
                  // const W = 5 * D;
                  // const MO = 4 * W;
                  // while ((m = unitRe2.exec(duration)) !== null) {
                  //   const val = parseInt(m[1], 10);
                  //   const unit = m[2].toLowerCase();
                  //   if (Number.isNaN(val)) continue;
                  //   if (unit === 'mo') seconds += val * MO;
                  //   else if (unit === 'w') seconds += val * W;
                  //   else if (unit === 'd') seconds += val * D;
                  //   else if (unit === 'h') seconds += val * H;
                  //   else if (unit === 'm') seconds += val * 60;
                  //   else if (unit === 's') seconds += val;
                  // }
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
            //     const unitRe = /(-?\d+)\s*(mo|w|d|h|m|s)\b/gi;
            //     let mm;
            //     const H = 3600;
            //     const D = 8 * H;
            //     const W = 5 * D;
            //     const MO = 4 * W;
                // تلاش برای استخراج duration دقیق پس از added/subtracted/removed/deleted و هر دو ترتیب عبارت
                const addSubMatch = body.match(/(?:added|subtracted|removed|deleted)\s+(.+?)\s+of\s+(?:time\s+spent|spent\s+time)/i);
                const parseSource = addSubMatch ? addSubMatch[1] : body;
            //     while ((mm = unitRe.exec(parseSource)) !== null) {
            //       const val = parseInt(mm[1], 10);
            //       const unit = mm[2].toLowerCase();
            //       if (Number.isNaN(val)) continue;
            //       if (unit === 'mo') seconds += val * MO;
            //       else if (unit === 'w') seconds += val * W;
            //       else if (unit === 'd') seconds += val * D;
            //       else if (unit === 'h') seconds += val * H;
            //       else if (unit === 'm') seconds += val * 60;
            //       else if (unit === 's') seconds += val;
            //     }
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
                // --- time estimate changes ---
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
                    // add/sub/changed estimate
                  //   const H = 3600,
                  //     D = 8 * H,
                  //     W = 5 * D,
                  //     MO = 4 * W;
                  //   const unitRe = /(-?\d+)\s*(mo|w|d|h|m|s)\b/gi;
                    const added = body.includes('added') && body.includes('time estimate');
                    const removed = (body.includes('subtracted') || body.includes('removed') || body.includes('deleted')) && body.includes('time estimate');
                    const changedMatch = body.match(/changed\s+time\s+estimate\s+to\s+(.+?)(?:\.|$)/i);
                    if (!(added || removed || changedMatch)) {
                      // nothing
                    } else {
                      let desiredDelta = 0;
                      if (changedMatch) {
                        let seconds = 0;
                        // let m;
                        const src = changedMatch[1];
                        // while ((m = unitRe.exec(src)) !== null) {
                        //   const val = parseInt(m[1], 10);
                        //   const unit = m[2].toLowerCase();
                        //   if (Number.isNaN(val)) continue;
                        //   if (unit === 'mo') seconds += val * MO;
                        //   else if (unit === 'w') seconds += val * W;
                        //   else if (unit === 'd') seconds += val * D;
                        //   else if (unit === 'h') seconds += val * H;
                        //   else if (unit === 'm') seconds += val * 60;
                        //   else if (unit === 's') seconds += val;
                        // }
                        seconds = parseDurationString(src);
                        // desiredDelta = toValue - current
                        const curr = Number((usersMap[userIdsSet.has(authorId) ? authorId : recipients[0]?.id] && usersMap[userIdsSet.has(authorId) ? authorId : recipients[0]?.id].issues[issue.iid]?.estimateCurrent) || 0);
                        desiredDelta = seconds - curr;
                      } else {
                        let seconds = 0;
                        // let m;
                        // Support both orders:
                        // 1) "added 1w of time estimate"
                        // 2) "added time estimate of 1w"
                        const srcMatchA = body.match(/(?:added|subtracted|removed|deleted)\s+(.+?)\s+of\s+(?:time\s+estimate|estimate\s+time)/i);
                        const srcMatchB = body.match(/(?:added|subtracted|removed|deleted)\s+(?:time\s+estimate|estimate\s+time)\s+of\s+(.+?)(?:\.|$)/i);
                        const src = srcMatchA ? srcMatchA[1] : srcMatchB ? srcMatchB[1] : body;
                        // while ((m = unitRe.exec(src)) !== null) {
                        //   const val = parseInt(m[1], 10);
                        //   const unit = m[2].toLowerCase();
                        //   if (Number.isNaN(val)) continue;
                        //   if (unit === 'mo') seconds += val * MO;
                        //   else if (unit === 'w') seconds += val * W;
                        //   else if (unit === 'd') seconds += val * D;
                        //   else if (unit === 'h') seconds += val * H;
                        //   else if (unit === 'm') seconds += val * 60;
                        //   else if (unit === 's') seconds += val;
                        // }
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
                      if (isInRange(noteKey)) {
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

      // --- اضافه کردن ایشوهای خالی برای هر کاربر ---
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
        let realnessSum = 0;
        let suspiciousIssueCount = 0;

        const daily = workingDateKeys.map(k => {
          const issuesArr = Object.values(u.issues || {})
            .map(iss => ({ iid: iss.iid, spent: (iss.byDate && iss.byDate[k]) || 0 }))
            .filter(x => x.spent !== 0);
          return {
            date: k,
            spent: u.byDate[k] || 0,
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
        u.totalEstimate = totalEstimate;
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
        emptyIssues: u.emptyIssues, // اضافه شد
        labels: Array.from(u.labels),
      }));

      // ساخت و ذخیره فایل اکسل خروجی
      try {
        const workbook = new ExcelJS.Workbook();
        const wsSummary = workbook.addWorksheet('Summary');
        wsSummary.columns = [
          { header: 'User ID', key: 'userId', width: 12 },
          { header: 'Username', key: 'username', width: 20 },
          { header: 'Name', key: 'name', width: 24 },
          { header: 'Total Spent (h)', key: 'totalSpentH', width: 16 },
          { header: 'Total Estimate (h)', key: 'totalEstimateH', width: 18 },
          { header: 'Spent/Estimate', key: 'spentToEstimate', width: 16 },
          { header: 'Realness', key: 'realness', width: 12 },
          { header: 'Quality', key: 'quality', width: 12 },
          { header: 'Absence', key: 'absence', width: 12 },
          { header: 'Score', key: 'score', width: 12 },
        ];
        for (const u of results) {
          const s = u.summary?.scores || {};
          wsSummary.addRow({
            userId: u.userId,
            username: u.username,
            name: u.name,
            totalSpentH: ((u.summary?.totalSpent || 0) / 3600).toFixed(2),
            totalEstimateH: ((u.summary?.totalEstimate || 0) / 3600).toFixed(2),
            spentToEstimate: u.summary?.spentToEstimate ?? '',
            realness: s.realness ?? '',
            quality: s.quality ?? '',
            absence: s.absence ?? '',
            score: s.totalScore ?? '',
          });
        }

        const wsIssues = workbook.addWorksheet('Issues');
        wsIssues.columns = [
          { header: 'User ID', key: 'userId', width: 12 },
          { header: 'Username', key: 'username', width: 20 },
          { header: 'Issue IID', key: 'iid', width: 10 },
          { header: 'Title', key: 'title', width: 40 },
          { header: 'State', key: 'state', width: 12 },
          { header: 'Spent (h)', key: 'spentH', width: 12 },
          { header: 'Estimate (h)', key: 'estimateH', width: 14 },
          { header: 'Comments', key: 'comments', width: 10 },
        ];
        for (const u of results) {
          for (const iss of u.issues || []) {
            wsIssues.addRow({
              userId: u.userId,
              username: u.username,
              iid: iss.iid,
              title: iss.title,
              state: iss.state,
              spentH: ((iss.spentInRange || 0) / 3600).toFixed(2),
              comments: iss.commentsInRange || 0,
              estimateH: ((iss.estimateInRange || 0) / 3600).toFixed(2),
            });
          }
        }

        // Header styling and filters for Summary and Issues
        try {
          wsSummary.getRow(1).font = { bold: true };
          wsSummary.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
          wsSummary.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
          wsSummary.getColumn('totalSpentH').numFmt = '#,##0.00';
          wsSummary.getColumn('realness').numFmt = '0.00%';
          wsSummary.getColumn('quality').numFmt = '0.00%';
          wsSummary.getColumn('absence').numFmt = '0.00%';
          wsSummary.getColumn('score').numFmt = '0.00%';
          wsSummary.autoFilter = { from: 'A1', to: wsSummary.getRow(1).getCell(wsSummary.columns.length).address };
          wsSummary.views = [{ state: 'frozen', ySplit: 1 }];
          wsIssues.getRow(1).font = { bold: true };
          wsIssues.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
          wsIssues.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
          wsIssues.getColumn('spentH').numFmt = '#,##0.00';
          wsIssues.getColumn('comments').numFmt = '0';
          wsIssues.autoFilter = { from: 'A1', to: wsIssues.getRow(1).getCell(wsIssues.columns.length).address };
          wsIssues.views = [{ state: 'frozen', ySplit: 1 }];
        } catch (e) {}

        // Daily worksheet (per-user daily spend including absences)
        const wsDaily = workbook.addWorksheet('Daily');
        wsDaily.columns = [
          { header: 'User ID', key: 'userId', width: 12 },
          { header: 'Username', key: 'username', width: 18 },
          { header: 'Date', key: 'date', width: 14 },
          { header: 'Spent (s)', key: 'spent', width: 12 },
          { header: 'Spent (h:m)', key: 'spent_hm', width: 14 },
          { header: 'Is Absence', key: 'isAbsence', width: 12 },
          { header: 'Estimate (s)', key: 'estimate', width: 14 },
          { header: 'Estimate (h:m)', key: 'estimate_hm', width: 16 },
        ];
        for (const u of results) {
          const daily = Array.isArray(u.dailySummary) ? u.dailySummary : [];
          const estDaily = Array.isArray(u.estimateDailySummary) ? u.estimateDailySummary : [];
          const estByDate = new Map(estDaily.map(d => [d.date, d]));
          for (const d of daily) {
            const e = estByDate.get(d.date);
            wsDaily.addRow({
              userId: u.userId,
              username: u.username,
              date: d.date,
              spent: d.spent || 0,
              spent_hm: d.spent_hm || '',
              isAbsence: d.isAbsence ? 'Y' : '',
              estimate: e ? e.estimate || 0 : 0,
              estimate_hm: e ? e.estimate_hm || '' : '',
            });
          }
        }
        try {
          wsDaily.getRow(1).font = { bold: true };
          wsDaily.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
          wsDaily.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
          wsDaily.getColumn('spent').numFmt = '0';
          wsDaily.autoFilter = { from: 'A1', to: wsDaily.getRow(1).getCell(wsDaily.columns.length).address };
          wsDaily.views = [{ state: 'frozen', ySplit: 1 }];
        } catch (e) {}

        // IssueQuality worksheet (detailed quality metrics per issue)
        const wsIssueQuality = workbook.addWorksheet('IssueQuality');
        wsIssueQuality.columns = [
          { header: 'User ID', key: 'userId', width: 12 },
          { header: 'Username', key: 'username', width: 18 },
          { header: 'Issue IID', key: 'iid', width: 10 },
          { header: 'Title', key: 'title', width: 40 },
          { header: 'QualityScore', key: 'qualityScore', width: 14 },
          { header: 'Has Title', key: 'hasTitle', width: 12 },
          { header: 'Has Description', key: 'hasDescription', width: 16 },
          { header: 'Labels Count', key: 'labelsCount', width: 14 },
          { header: 'Has Status Label', key: 'hasStatusLabel', width: 18 },
          { header: 'Description Edits', key: 'descriptionEdits', width: 18 },
          { header: 'Spent/Estd Ratio', key: 'spentToEstimateRatio', width: 16 },
          { header: 'Comments In Range', key: 'commentsInRange', width: 18 },
          { header: 'Penalties', key: 'qualityPenalties', width: 40 },
          { header: 'Suspicious Reasons', key: 'suspiciousReasonsText', width: 40 },
        ];
        for (const u of results) {
          for (const iss of u.issues || []) {
            const q = iss.quality || {};
            wsIssueQuality.addRow({
              userId: u.userId,
              username: u.username,
              iid: iss.iid,
              title: iss.title,
              qualityScore: typeof q.qualityScore === 'number' ? q.qualityScore : '',
              hasTitle: q.hasTitle === false ? 'No' : 'Yes',
              hasDescription: q.hasDescription === false ? 'No' : 'Yes',
              labelsCount: q.labelsCount ?? '',
              hasStatusLabel: q.hasStatusLabel === false ? 'No' : 'Yes',
              descriptionEdits: q.descriptionEdits ?? q.descriptionEditsInRange ?? 0,
              spentToEstimateRatio: q.spentToEstimateRatio ?? '',
              commentsInRange: q.commentsInRange ?? iss.commentsInRange ?? 0,
              qualityPenalties: Array.isArray(q.qualityPenalties) ? q.qualityPenalties.join(', ') : '',
              suspiciousReasonsText: Array.isArray(iss.suspiciousReasonsText) ? iss.suspiciousReasonsText.join(', ') : '',
            });
          }
        }
        try {
          wsIssueQuality.getRow(1).font = { bold: true };
          wsIssueQuality.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
          wsIssueQuality.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
          wsIssueQuality.getColumn('qualityScore').numFmt = '0.00';
          wsIssueQuality.getColumn('spentToEstimateRatio').numFmt = '0.00';
          wsIssueQuality.autoFilter = { from: 'A1', to: wsIssueQuality.getRow(1).getCell(wsIssueQuality.columns.length).address };
          wsIssueQuality.views = [{ state: 'frozen', ySplit: 1 }];
        } catch (e) {}

        // Guidance worksheet (per-user guidance messages)
        const wsGuidance = workbook.addWorksheet('Guidance');
        wsGuidance.columns = [
          { header: 'User ID', key: 'userId', width: 12 },
          { header: 'Username', key: 'username', width: 18 },
          { header: 'Message', key: 'message', width: 120 },
        ];
        for (const u of results) {
          const msgs = u.summary && Array.isArray(u.summary.guidance) ? u.summary.guidance : [];
          for (const m of msgs) {
            wsGuidance.addRow({ userId: u.userId, username: u.username, message: m });
          }
        }
        try {
          wsGuidance.getRow(1).font = { bold: true };
          wsGuidance.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
          wsGuidance.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
          wsGuidance.autoFilter = { from: 'A1', to: wsGuidance.getRow(1).getCell(wsGuidance.columns.length).address };
          wsGuidance.views = [{ state: 'frozen', ySplit: 1 }];
        } catch (e) {}

        // Absences worksheet (dates with zero spent)
        const wsAbsences = workbook.addWorksheet('Absences');
        wsAbsences.columns = [
          { header: 'User ID', key: 'userId', width: 12 },
          { header: 'Username', key: 'username', width: 18 },
          { header: 'Date', key: 'date', width: 14 },
        ];
        for (const u of results) {
          const abs = u.summary && Array.isArray(u.summary.absenceDays) ? u.summary.absenceDays : [];
          for (const ad of abs) {
            wsAbsences.addRow({ userId: u.userId, username: u.username, date: ad });
          }
        }
        try {
          wsAbsences.getRow(1).font = { bold: true };
          wsAbsences.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
          wsAbsences.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
          wsAbsences.autoFilter = { from: 'A1', to: wsAbsences.getRow(1).getCell(wsAbsences.columns.length).address };
          wsAbsences.views = [{ state: 'frozen', ySplit: 1 }];
        } catch (e) {}

        // Labels worksheet (distinct labels per user)
        const wsLabels = workbook.addWorksheet('Labels');
        wsLabels.columns = [
          { header: 'User ID', key: 'userId', width: 12 },
          { header: 'Username', key: 'username', width: 18 },
          { header: 'Label', key: 'label', width: 40 },
        ];
        for (const u of results) {
          for (const label of u.labels || []) {
            wsLabels.addRow({ userId: u.userId, username: u.username, label });
          }
        }
        try {
          wsLabels.getRow(1).font = { bold: true };
          wsLabels.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
          wsLabels.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
          wsLabels.autoFilter = { from: 'A1', to: wsLabels.getRow(1).getCell(wsLabels.columns.length).address };
          wsLabels.views = [{ state: 'frozen', ySplit: 1 }];
        } catch (e) {}

        // Metadata worksheet (request params and weights)
        const wsMeta = workbook.addWorksheet('Metadata');
        wsMeta.columns = [
          { header: 'Key', key: 'key', width: 24 },
          { header: 'Value', key: 'value', width: 80 },
        ];
        wsMeta.addRow({ key: 'users', value: String(users) });
        wsMeta.addRow({ key: 'from', value: startKey });
        wsMeta.addRow({ key: 'to', value: endKey });
        wsMeta.addRow({ key: 'generated_at', value: new Date().toISOString() });
        wsMeta.addRow({ key: 'weights.realness', value: String(weights.realness) });
        wsMeta.addRow({ key: 'weights.quality', value: String(weights.quality) });
        wsMeta.addRow({ key: 'weights.absence', value: String(weights.absence) });
        try {
          wsMeta.getRow(1).font = { bold: true };
          wsMeta.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
          wsMeta.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
          wsMeta.views = [{ state: 'frozen', ySplit: 1 }];
        } catch (e) {}

        // Totals/Averages rows
        try {
          // Summary totals at the end
          const lastSummaryRow = wsSummary.rowCount + 1;
          wsSummary.addRow({ name: 'Totals/Averages:' });
          // totalSpentH sum, others average
          wsSummary.getCell(`D${lastSummaryRow}`).value = { formula: `SUM(D2:D${lastSummaryRow - 1})` };
          wsSummary.getCell(`E${lastSummaryRow}`).value = { formula: `SUM(E2:E${lastSummaryRow - 1})` };
          // Spent/Estimate average
          wsSummary.getCell(`G${lastSummaryRow}`).value = { formula: `AVERAGE(G2:G${lastSummaryRow - 1})` };
          wsSummary.getCell(`H${lastSummaryRow}`).value = { formula: `AVERAGE(H2:H${lastSummaryRow - 1})` };
          wsSummary.getCell(`I${lastSummaryRow}`).value = { formula: `AVERAGE(I2:I${lastSummaryRow - 1})` };
          wsSummary.getCell(`J${lastSummaryRow}`).value = { formula: `AVERAGE(J2:J${lastSummaryRow - 1})` };
          wsSummary.getRow(lastSummaryRow).font = { bold: true };

          // Issues totals
          const lastIssuesRow = wsIssues.rowCount + 1;
          wsIssues.addRow({ title: 'Totals:' });
          wsIssues.getCell(`F${lastIssuesRow}`).value = { formula: `SUM(F2:F${lastIssuesRow - 1})` };
          wsIssues.getCell(`G${lastIssuesRow}`).value = { formula: `SUM(G2:G${lastIssuesRow - 1})` };
          wsIssues.getRow(lastIssuesRow).font = { bold: true };
        } catch (e) {}

        // Light conditional accents by value thresholds (applied as fill colors)
        try {
          // Summary score color cues
          for (let r = 2; r <= wsSummary.rowCount; r++) {
            const scoreCell = wsSummary.getCell(`H${r}`);
            const scoreVal = Number(scoreCell.value);
            if (!Number.isNaN(scoreVal)) {
              if (scoreVal >= 0.8) scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3FCEF' } };
              else if (scoreVal >= 0.5) scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CE' } };
              else scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE7E9' } };
            }
          }
          // IssueQuality qualityScore cues
          for (let r = 2; r <= wsIssueQuality.rowCount; r++) {
            const qCell = wsIssueQuality.getCell(`E${r}`);
            const qVal = Number(qCell.value);
            if (!Number.isNaN(qVal)) {
              if (qVal >= 0.8) qCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3FCEF' } };
              else if (qVal >= 0.5) qCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4CE' } };
              else qCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE7E9' } };
            }
          }
        } catch (e) {}

        const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        const safeUsers = String(users).replace(/[^0-9,]/g, '');
        const filename = `activity-range_${safeUsers}_${startKey}_to_${endKey}_${ts}.xlsx`;
        await workbook.xlsx.writeFile(filename);
        console.log(`Excel exported: ${filename}`);
      } catch (ex) {
        console.error('Excel export failed:', ex?.message || ex);
      }

      res.json(results);
    } catch (error) {
      console.error(error);
      res.status(500).json({
        message: 'خطا در تولید گزارش بازه‌ای فعالیت کاربران',
        error: error?.message || String(error),
      });
    }
  });
}

/*
function extractProjectFromLabels(labels) {
  if (!labels || !Array.isArray(labels)) {
    return "Unknown Project";
  }

  const projectLabel = labels.find((label) => label.startsWith("Project:"));

  if (projectLabel) {
    const projectName = projectLabel.replace("Project:", "").trim();
    console.log(`پروژه پیدا شد: ${projectName} از لیبل: ${projectLabel}`);
    return projectName;
  }

  console.log(`لیبل پروژه پیدا نشد در: ${JSON.stringify(labels)}`);
  return "Unknown Project";
}

async function getProjectName(baseUUrl, projectId) {
  if (projectNameCache[projectId]) {
    return projectNameCache[projectId];
  }

  const response = await fetch(`${baseUUrl}/projects/${projectId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": token,
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
}*/

async function getAllIssuesFromProject(baseUUrl, projectId, milestone) {
  let allIssues = [];
  let page = 1;

  while (true) {
    const response = await fetch(`${baseUUrl}/projects/${projectId}/issues?milestone=${encodeURIComponent(milestone)}&page=${page}&per_page=${perPage}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': token,
      },
    });

    if (!response.ok) {
      console.error(`خطا در گرفتن issues از پروژه ${projectId}, صفحه ${page}`);
      break;
    }

    const issues = await response.json();

    if (issues.length === 0) {
      break;
    }

    allIssues = allIssues.concat(issues);
    page++;

    if (issues.length < perPage) {
      break;
    }
  }

  return allIssues;
}

async function getAllProjectIdsFromGroup(baseUUrl) {
  if (!groupId) return [];
  let page = 1;
  const ids = [];
  while (true) {
    const url = `${baseUUrl}/groups/${encodeURIComponent(groupId)}/projects?include_subgroups=true&archived=false&per_page=${perPage}&page=${page}`;
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': token,
      },
    });
    if (!r.ok) break;
    const chunk = await r.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    for (const p of chunk) {
      const pid = p?.id ?? p?.project_id;
      if (pid) ids.push(pid);
    }
    const nextPageHeader = r.headers.get('x-next-page');
    if (!nextPageHeader || nextPageHeader === '0' || chunk.length < perPage) break;
    page = parseInt(nextPageHeader, 10) || page + 1;
  }
  return ids;
}

async function resolveProjectIds(baseUUrl, projectIdParam) {
  if (projectIdParam === 'all') {
    const dynamicIds = await getAllProjectIdsFromGroup(baseUUrl);
    if (Array.isArray(dynamicIds) && dynamicIds.length > 0) return dynamicIds;
    if (Array.isArray(ALL_PROJECT_IDS) && ALL_PROJECT_IDS.length > 0) return ALL_PROJECT_IDS;
    throw new Error('Project list is empty. Set GITLAB_GROUP_ID or populate ALL_PROJECT_IDS.');
  }
  return [projectIdParam];
}

function getProjectDisplayNameFromLabel(projectLabel) {
  if (typeof projectLabel !== 'string') return String(projectLabel || '');
  if (projectLabel.startsWith('Project:')) {
    return projectLabel.replace('Project:', '').trim();
  }
  return projectLabel;
}

function getStatusDisplayNameFromLabel(projectLabel) {
  if (typeof projectLabel !== 'string') return String(projectLabel || '');
  if (projectLabel.startsWith('Status:')) {
    return projectLabel.replace('Status:', '').trim();
  }
  return projectLabel;
}

async function fetchGitlabUsers() {
  const response = await fetch(`${baseUUrl}/users`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': token,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to fetch GitLab users');
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

// --- Universal duration parser (e.g., '3d 4h 46m' to total seconds) ---
function parseDurationString(str) {
      if (typeof str !== 'string') return 0;
      let seconds = 0;
      const unitRe = /(-?\d+)\s*(mo|w|d|h|m|s)\b/gi;
      let m;
      const H = 3600;
      const D = 8 * H;
      const W = 5 * D;
      const MO = 4 * W;
      while ((m = unitRe.exec(str)) !== null) {
          const val = parseInt(m[1], 10);
          const unit = m[2].toLowerCase();
          if (Number.isNaN(val)) continue;
          if (unit === 'mo') seconds += val * MO;
          else if (unit === 'w') seconds += val * W;
          else if (unit === 'd') seconds += val * D;
          else if (unit === 'h') seconds += val * H;
          else if (unit === 'm') seconds += val * 60;
          else if (unit === 's') seconds += val;
      }
      return seconds;
  }
