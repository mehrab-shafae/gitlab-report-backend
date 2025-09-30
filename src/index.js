import dotenv from "dotenv";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";

dotenv.config();
const app = express();


app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://gitlabreport.forvestlab.ir",
    ],
    credentials: true,
  }),
);


app.use(express.json());


const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
mongoose
  .connect(mongoUri, { dbName: process.env.MONGODB_DB || "forvest_git" })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err.message));


const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean },
  },
  { timestamps: true },
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

app.get("/milestones", async (req, res) => {
  try {
    const baseUUrl = process.env.GITLAB_BASE_URL;

    const response = await fetch(`${baseUUrl}/projects/91/milestones`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
      },
    });

    if (!response.ok) {
      return res.json({
        status: "err",
      });
    }

    const data = await response.json();
    res.json({
      data: data,
    });
  } catch (error) {
    console.log(45);
    res.status(500).json({
      message: "Failed to fetch milestones report",
      error: error?.message || String(error),
    });
  }
});

app.get("/Users", async (req, res) => {
  const baseUUrl = process.env.GITLAB_BASE_URL;

  const response = await fetch(`${baseUUrl}/users`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
    },
  });

  const data = await response.json();
  console.log(data);

  const activeUser = data.filter((user) => {
    if (user.state) {
      return true;
    } else {
      return false;
    }
  });

  res.json({
    status: "success",
    data: activeUser,
  });
});
app.get("/labels", async (req, res) => {
  try {
    const baseUUrl = process.env.GITLAB_BASE_URL;
    const token = process.env.GITLAB_TOKEN;
    const projectId = req.query.projectId || process.env.GITLAB_PROJECT_ID;

    if (!baseUUrl || !token) {
      return res
        .status(500)
        .json({ message: "GITLAB_BASE_URL یا GITLAB_TOKEN ست نشده است" });
    }
    if (!projectId) {
      return res
        .status(400)
        .json({ message: "projectId مشخص نیست (query یا .env)" });
    }

    
    let andLabels = [];
    if (req.query.labels) {
      if (Array.isArray(req.query.labels)) {
        andLabels = req.query.labels;
      } else if (typeof req.query.labels === "string") {
        andLabels = req.query.labels
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean);
      }
    }

    const params = new URLSearchParams({
      per_page: "100",
      with_counts: (req.query.with_counts ?? "true").toString(),
      include_ancestor_groups: (
        req.query.include_ancestor_groups ?? "true"
      ).toString(),
    });
    if (req.query.search) params.set("search", String(req.query.search));

    let page = 1;
    const allLabels = [];
    while (true) {
      params.set("page", String(page));
      const url = `${baseUUrl}/projects/${encodeURIComponent(projectId)}/labels?${params.toString()}`;

      const r = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "PRIVATE-TOKEN": token,
        },
      });

      if (!r.ok) {
        return res
          .status(r.status)
          .json({ status: "err", message: `GitLab responded ${r.status}` });
      }

      const chunk = await r.json();
      allLabels.push(...chunk);

      
      const nextPageHeader = r.headers.get("x-next-page");
      const perPage = Number(params.get("per_page")) || 100;
      if (!nextPageHeader || nextPageHeader === "0" || chunk.length < perPage)
        break;

      page = parseInt(nextPageHeader, 10) || page + 1;
    }

    
    if (andLabels.length > 0) {
      
      let issues = [];
      let issuePage = 1;
      const perPage = 100;
      while (true) {
        const issueParams = new URLSearchParams({
          per_page: String(perPage),
          page: String(issuePage),
          state: "all",
        });
        const issuesUrl = `${baseUUrl}/projects/${encodeURIComponent(projectId)}/issues?${issueParams.toString()}`;
        const issuesResp = await fetch(issuesUrl, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "PRIVATE-TOKEN": token,
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
        
        if (andLabels.every((l) => issue.labels.includes(l))) {
          for (const l of issue.labels) {
            labelSet.add(l);
          }
        }
      }
      
      const filteredLabels = allLabels.filter((lbl) => labelSet.has(lbl.name));
      return res.json({ status: "success", data: filteredLabels });
    }

    res.json({ status: "success", data: allLabels });
  } catch (e) {
    res.status(500).json({
      message: "Failed to fetch labels",
      error: e?.message || String(e),
    });
  }
});

const ALL_PROJECT_IDS = [];


const projectNameCache = {};


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
      "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
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
}


async function getAllIssuesFromProject(baseUUrl, projectId, milestone) {
  let allIssues = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response = await fetch(
      `${baseUUrl}/projects/${projectId}/issues?milestone=${encodeURIComponent(
        milestone,
      )}&page=${page}&per_page=${perPage}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
        },
      },
    );

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
  const groupId = process.env.GITLAB_GROUP_ID;
  if (!groupId) return [];
  const perPage = 100;
  let page = 1;
  const ids = [];
  while (true) {
    const url = `${baseUUrl}/groups/${encodeURIComponent(groupId)}/projects?include_subgroups=true&archived=false&per_page=${perPage}&page=${page}`;
    const r = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
      },
    });
    if (!r.ok) break;
    const chunk = await r.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    for (const p of chunk) {
      const pid = p?.id ?? p?.project_id;
      if (pid) ids.push(pid);
    }
    const nextPageHeader = r.headers.get("x-next-page");
    if (!nextPageHeader || nextPageHeader === "0" || chunk.length < perPage)
      break;
    page = parseInt(nextPageHeader, 10) || page + 1;
  }
  return ids;
}


async function resolveProjectIds(baseUUrl, projectIdParam) {
  if (projectIdParam === "all") {
    const dynamicIds = await getAllProjectIdsFromGroup(baseUUrl);
    if (Array.isArray(dynamicIds) && dynamicIds.length > 0) return dynamicIds;
    if (Array.isArray(ALL_PROJECT_IDS) && ALL_PROJECT_IDS.length > 0)
      return ALL_PROJECT_IDS;
    throw new Error(
      "Project list is empty. Set GITLAB_GROUP_ID or populate ALL_PROJECT_IDS.",
    );
  }
  return [projectIdParam];
}


function getProjectDisplayNameFromLabel(projectLabel) {
  if (typeof projectLabel !== "string") return String(projectLabel || "");
  if (projectLabel.startsWith("Project:")) {
    return projectLabel.replace("Project:", "").trim();
  }
  return projectLabel;
}

app.get("/time-spends", async (req, res) => {
  try {
    const baseUUrl = process.env.GITLAB_BASE_URL;
    const { milestone, projectId, userId, workingDays } = req.query;
    const numWorkingDays = Number(workingDays);

    if (!milestone || !projectId) {
      return res
        .status(400)
        .json({ message: "milestone و projectId الزامی هستند" });
    }

    
    const perPage = 100;
    let page = 1;
    let issues = [];
    while (true) {
      const resp = await fetch(
        `${baseUUrl}/projects/${projectId}/issues?milestone=${encodeURIComponent(milestone)}&state=all&page=${page}&per_page=${perPage}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
          },
        },
      );
      if (!resp.ok) {
        return res
          .status(500)
          .json({ message: "مشکل در گرفتن دیتا از GitLab" });
      }
      const batch = await resp.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      issues = issues.concat(batch);
      if (batch.length < perPage) break;
      page += 1;
    }
    let usersIssues = [];

    
    if (userId && userId !== "all") {
      
      const userIssues = issues.filter((issue) => {
        const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
        const inAssignees = assignees.some((a) => a && a.id == userId);
        const legacy = issue.assignee && issue.assignee.id == userId;
        return inAssignees || legacy;
      });

      
      let totalSpent = 0;
      let totalEstimate = 0;

      const projectsMap = {};
      for (const issue of userIssues) {
        const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
        const hasLegacy = !!issue.assignee;
        const assigneeCount =
          assignees.length > 0 ? assignees.length : hasLegacy ? 1 : 0;
        const shareSpent =
          assigneeCount > 0
            ? (issue.time_stats?.total_time_spent || 0) / assigneeCount
            : 0;
        const shareEstimate =
          assigneeCount > 0
            ? (issue.time_stats?.time_estimate || 0) / assigneeCount
            : 0;
        totalSpent += shareSpent;
        totalEstimate += shareEstimate;
        const projectLabel = issue.labels.find((l) =>
          l.startsWith("Project: "),
        );
        if (!projectLabel) continue;

        if (!projectsMap[projectLabel]) {
          projectsMap[projectLabel] = {
            projectLabel,
            projectName: getProjectDisplayNameFromLabel(projectLabel),
            totalSpent: 0,
            totalEstimate: 0,
            percentWork: 0,
          };
        }

        projectsMap[projectLabel].totalSpent += shareSpent;
        projectsMap[projectLabel].totalEstimate += shareEstimate;
      }

      Object.values(projectsMap).forEach((proj) => {
        proj.percentWork =
          totalSpent > 0
            ? ((proj.totalSpent / totalSpent) * 100).toFixed(2)
            : 0;
        
        proj.performance =
          numWorkingDays && numWorkingDays > 0
            ? ((proj.totalSpent / (numWorkingDays * 8 * 3600)) * 100).toFixed(2)
            : 0;
      });

      
      
      let userInfo = {};
      for (const issue of userIssues) {
        const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
        const found = assignees.find((a) => a && a.id == userId);
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
        username: userInfo.username || "",
        name: userInfo.name || "",
        avatar_url: userInfo.avatar_url || "",
        totalSpent,
        totalEstimate,
        projects: Object.values(projectsMap),
      });
    }
    
    else {
      const usersMap = {};

      for (const issue of issues) {
        const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
        const hasLegacy = !!issue.assignee;
        const recipients =
          assignees.length > 0 ? assignees : hasLegacy ? [issue.assignee] : [];
        if (recipients.length === 0) continue;

        const shareSpent =
          (issue.time_stats?.total_time_spent || 0) / recipients.length;
        const shareEstimate =
          (issue.time_stats?.time_estimate || 0) / recipients.length;

        const projectLabel = issue.labels.find((l) =>
          l.startsWith("Project: "),
        );
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
            };
          }

          usersMap[uid].projects[projectLabel].totalSpent += shareSpent;
          usersMap[uid].projects[projectLabel].totalEstimate += shareEstimate;
          if (issue.iid) {
            usersMap[uid].projects[projectLabel].issueIds.push(issue.iid);
          }
        }
      }

      
      Object.values(usersMap).forEach((user) => {
        Object.values(user.projects).forEach((proj) => {
          const toHM = (sec) => {
            const s = Math.round(Number(sec) || 0);
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            return `${h}h ${m}m`;
          };
          const ids = Array.isArray(proj.issueIds) ? proj.issueIds : [];
          const idsPreview = ids.slice(0, 5).join(",");
          const idsSuffix = ids.length > 5 ? `(+${ids.length - 5} more)` : "";
          console.log(
            `[time-spends] user="${user.name}" spent=${toHM(user.totalSpent)} estimate=${toHM(user.totalEstimate)} | project="${proj.projectName}" projSpent=${toHM(proj.totalSpent)} | issues=[${idsPreview}] ${idsSuffix}`,
          );
          proj.percentWork =
            user.totalSpent > 0
              ? ((proj.totalSpent / user.totalSpent) * 100).toFixed(2)
              : 0;
          
          proj.performance =
            numWorkingDays && numWorkingDays > 0
              ? ((proj.totalSpent / (numWorkingDays * 8 * 3600)) * 100).toFixed(
                  2,
                )
              : 0;
        });
        user.projects = Object.values(user.projects);
      });

      usersIssues = Object.values(usersMap);
    }

    res.json(usersIssues);
  } catch (error) {
    res.status(500).json({
      message: "خطا در پردازش دیتا",
      error: error?.message || String(error),
    });
  }
});


app.get("/milestone-daily-spends", async (req, res) => {
  try {
    const baseUUrl = process.env.GITLAB_BASE_URL;
    const { projectId = "all", milestone } = req.query;

    if (!milestone) {
      return res.status(400).json({ message: "milestone الزامی است" });
    }

    
    const parseSpentFromNote = (body) => {
      if (typeof body !== "string") return { seconds: 0, forDate: null };
      const lowered = body.toLowerCase();
      
      const del = lowered.match(
        /deleted\s+(.+?)\s+of\s+spent\s+time\s+from\s+(\d{4}-\d{2}-\d{2})/i,
      );
      const unitRe = /(\d+)\s*(mo|w|d|h|m|s)\b/gi;
      const H = 3600;
      const D = 8 * H; 
      const W = 5 * D; 
      const MO = 4 * W; 
      if (del) {
        const duration = del[1];
        const forDate = del[2];
        let seconds = 0;
        let m;
        while ((m = unitRe.exec(duration)) !== null) {
          const val = parseInt(m[1], 10);
          const unit = m[2].toLowerCase();
          if (Number.isNaN(val)) continue;
          if (unit === "mo") seconds += val * MO;
          else if (unit === "w") seconds += val * W;
          else if (unit === "d") seconds += val * D;
          else if (unit === "h") seconds += val * H;
          else if (unit === "m") seconds += val * 60;
          else if (unit === "s") seconds += val;
        }
        return { seconds: -seconds, forDate };
      }
      const isAdd = lowered.includes("added") && lowered.includes("time spent");
      const isSub =
        lowered.includes("subtracted") && lowered.includes("time spent");
      if (!isAdd && !isSub) return { seconds: 0, forDate: null };
      let seconds = 0;
      let mm;
      while ((mm = unitRe.exec(lowered)) !== null) {
        const val = parseInt(mm[1], 10);
        const unit = mm[2].toLowerCase();
        if (Number.isNaN(val)) continue;
        if (unit === "mo") seconds += val * MO;
        else if (unit === "w") seconds += val * W;
        else if (unit === "d") seconds += val * D;
        else if (unit === "h") seconds += val * H;
        else if (unit === "m") seconds += val * 60;
        else if (unit === "s") seconds += val;
      }
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

        
        const notesResp = await fetch(
          `${baseUUrl}/projects/${pid}/issues/${issueIid}/notes?system=true&per_page=100`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
            },
          },
        );
        if (!notesResp.ok) continue;
        const notes = await notesResp.json();

        for (const note of notes) {
          if (!note?.body || !note?.created_at || !note?.author?.id) continue;
          const { seconds: deltaSeconds, forDate } = parseSpentFromNote(
            note.body,
          );
          if (deltaSeconds === 0) continue;

          
          const dateKey =
            forDate || new Date(note.created_at).toISOString().slice(0, 10);
          const author = note.author;
          const uid = author.id;

          if (!usersMap[uid]) {
            usersMap[uid] = {
              userId: uid,
              username: author.username || "",
              name: author.name || "",
              avatar_url: author.avatar_url || "",
              byDate: {},
            };
          }
          usersMap[uid].byDate[dateKey] =
            (usersMap[uid].byDate[dateKey] || 0) + deltaSeconds;
        }
      }
    }

    
    const monthMatch = String(milestone).match(/(\d{4})-(\d{2})/);
    const targetYear = monthMatch
      ? parseInt(monthMatch[1], 10)
      : new Date().getUTCFullYear();
    const targetMonthNum = monthMatch
      ? parseInt(monthMatch[2], 10)
      : new Date().getUTCMonth() + 1; 
    const monthIndex = targetMonthNum - 1; 
    const daysInMonth = new Date(
      Date.UTC(targetYear, monthIndex + 1, 0),
    ).getUTCDate();

    
    const monthDates = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(Date.UTC(targetYear, monthIndex, day))
        .toISOString()
        .slice(0, 10);
      monthDates.push(d);
    }

    
    const results = Object.values(usersMap).map((u) => ({
      userId: u.userId,
      username: u.username,
      name: u.name,
      avatar_url: u.avatar_url,
      spend: monthDates.map((d) => ({ date: d, spent: u.byDate[d] || 0 })),
    }));

    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: "خطا در تولید گزارش روزانه مایل‌استون",
      error: error?.message || String(error),
    });
  }
});

app.get("/labels-report", async (req, res) => {
  try {
    const baseUUrl = process.env.GITLAB_BASE_URL;
    const { milestone, labels, userId, projectId } = req.query;

    if (!labels) {
      return res.status(400).json({ message: "حداقل یک لیبل الزامی است" });
    }

    const labelList = labels.split(",").map((l) => l.trim());
    let projectIds = [];
    try {
      projectIds = await resolveProjectIds(baseUUrl, projectId);
    } catch (e) {
      return res.status(400).json({ message: e?.message || String(e) });
    }

    let allIssues = [];

    
    for (const pid of projectIds) {
      const perPage = 100;
      let page = 1;
      while (true) {
        const params = new URLSearchParams();
        if (milestone) params.append("milestone", milestone);
        
        let desiredState = (req.query.state || "opened")
          .toString()
          .toLowerCase();
        if (desiredState === "open") desiredState = "opened"; 
        if (!["opened", "closed", "all"].includes(desiredState))
          desiredState = "opened";
        params.set("state", desiredState);
        params.set("per_page", String(perPage));
        params.set("page", String(page));

        const response = await fetch(
          `${baseUUrl}/projects/${pid}/issues?${params.toString()}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
            },
          },
        );

        if (!response.ok) {
          return res
            .status(500)
            .json({ message: "مشکل در گرفتن دیتا از GitLab" });
        }

        const batch = await response.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        allIssues = allIssues.concat(batch);
        if (batch.length < perPage) break;
        page += 1;
      }
    }

    
    if (userId && userId !== "all") {
      allIssues = allIssues.filter((issue) => {
        const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
        const inAssignees = assignees.some((a) => a && a.id == userId);
        const legacy = issue.assignee && issue.assignee.id == userId;
        return inAssignees || legacy;
      });
    }

    
    const filteredIssues = allIssues.filter(
      (issue) =>
        Array.isArray(issue.labels) &&
        labelList.every((lbl) => issue.labels.includes(lbl)),
    );

    
    const totalSpent = filteredIssues.reduce(
      (sum, issue) => sum + (issue.time_stats?.total_time_spent || 0),
      0,
    );
    const issueCount = filteredIssues.length;
    const uniqueUsers = new Set(
      filteredIssues.flatMap((issue) => {
        const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
        const legacyAssignee = issue.assignee ? [issue.assignee] : [];
        return [...assignees, ...legacyAssignee]
          .map((a) => a?.id)
          .filter(Boolean);
      }),
    ).size;
    const avgSpentPerIssue =
      issueCount > 0 ? (totalSpent / issueCount).toFixed(2) : 0;
    const usersMap = {};
    for (const issue of filteredIssues) {
      const assignees = Array.isArray(issue.assignees) ? issue.assignees : [];
      const hasLegacy = !!issue.assignee;
      const recipients =
        assignees.length > 0 ? assignees : hasLegacy ? [issue.assignee] : [];
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
    Object.values(usersMap).forEach((user) => {
      user.percentWork =
        totalSpent > 0 ? ((user.spentTime / totalSpent) * 100).toFixed(2) : 0;
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
      message: "خطا در پردازش دیتا",
      error: error?.message || String(error),
    });
  }
});


app.get("/daily-report", async (req, res) => {
  try {
    const baseUUrl = process.env.GITLAB_BASE_URL;
    const { projectId = "all", date } = req.query;

    
    const targetDate = date || new Date().toISOString().slice(0, 10);

    
    let projectIds = [];
    try {
      projectIds = await resolveProjectIds(baseUUrl, projectId);
    } catch (e) {
      return res.status(400).json({ message: e?.message || String(e) });
    }

    
    const parseSpentFromNote = (body) => {
      if (typeof body !== "string") return { seconds: 0, forDate: null };
      const lowered = body.toLowerCase();
      const unitRe = /(\d+)\s*(mo|w|d|h|m|s)\b/gi;
      const H = 3600;
      const D = 8 * H;
      const W = 5 * D;
      const MO = 4 * W;
      
      const del = lowered.match(
        /deleted\s+(.+?)\s+of\s+spent\s+time\s+from\s+(\d{4}-\d{2}-\d{2})/i,
      );
      if (del) {
        const duration = del[1];
        const forDate = del[2];
        let seconds = 0;
        let m;
        while ((m = unitRe.exec(duration)) !== null) {
          const val = parseInt(m[1], 10);
          const unit = m[2].toLowerCase();
          if (Number.isNaN(val)) continue;
          if (unit === "mo") seconds += val * MO;
          else if (unit === "w") seconds += val * W;
          else if (unit === "d") seconds += val * D;
          else if (unit === "h") seconds += val * H;
          else if (unit === "m") seconds += val * 60;
          else if (unit === "s") seconds += val;
        }
        return { seconds: -seconds, forDate };
      }
      const isAdd = lowered.includes("added") && lowered.includes("time spent");
      const isSub =
        lowered.includes("subtracted") && lowered.includes("time spent");
      if (!isAdd && !isSub) return { seconds: 0, forDate: null };
      let seconds = 0;
      let mm;
      while ((mm = unitRe.exec(lowered)) !== null) {
        const val = parseInt(mm[1], 10);
        const unit = mm[2].toLowerCase();
        if (Number.isNaN(val)) continue;
        if (unit === "mo") seconds += val * MO;
        else if (unit === "w") seconds += val * W;
        else if (unit === "d") seconds += val * D;
        else if (unit === "h") seconds += val * H;
        else if (unit === "m") seconds += val * 60;
        else if (unit === "s") seconds += val;
      }
      return { seconds: isSub ? -seconds : seconds, forDate: null };
    };

    
    const usersMap = {};

    for (const pid of projectIds) {
      
      const issues = await getAllIssuesFromProject(baseUUrl, pid, "");

      for (const issue of issues) {
        const issueIid = issue.iid;
        if (!issueIid) continue;

        
        const notesResp = await fetch(
          `${baseUUrl}/projects/${pid}/issues/${issueIid}/notes?system=true&per_page=100`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
            },
          },
        );
        if (!notesResp.ok) continue;
        const notes = await notesResp.json();

        for (const note of notes) {
          
          const createdAt = note.created_at;
          if (!createdAt || !note.body) continue;
          const noteDate = new Date(createdAt).toISOString().slice(0, 10);

          const { seconds: deltaSeconds, forDate } = parseSpentFromNote(
            note.body,
          );
          if (deltaSeconds === 0) continue;
          
          const targetKey = forDate || noteDate;
          if (targetKey !== targetDate) continue;

          const author = note.author || {};
          const uid = author.id;
          if (!uid) continue;

          if (!usersMap[uid]) {
            usersMap[uid] = {
              userId: uid,
              username: author.username || "",
              name: author.name || "",
              avatar_url: author.avatar_url || "",
              dailySpent: 0,
            };
          }
          usersMap[uid].dailySpent += deltaSeconds;
        }
      }
    }

    const results = Object.values(usersMap).map((u) => ({
      userId: u.userId,
      username: u.username,
      name: u.name,
      avatar_url: u.avatar_url,
      dailySpent: u.dailySpent,
    }));

    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: "خطا در تولید گزارش روزانه",
      error: error?.message || String(error),
    });
  }
});


app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "username و password الزامی هستند" });
    }

    const user = await User.findOne({ username, password }).lean();
    if (!user) {
      return res.status(401).json({
        status: "error",
        message: "نام کاربری یا رمز عبور اشتباه است",
      });
    }

    return res.json({ status: "ok", message: "ورود موفق بود", user });
  } catch (error) {
    return res.status(500).json({
      message: "خطا در بررسی ورود",
      error: error?.message || String(error),
    });
  }
});

app.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "username و password الزامی هستند" });
    }

    const exists = await User.exists({ username });
    if (exists) {
      return res
        .status(409)
        .json({ message: "این نام کاربری قبلاً ثبت شده است" });
    }

    const created = await User.create({ username, password });
    return res.status(201).json({ status: "ok", id: created._id });
  } catch (error) {
    return res.status(500).json({
      message: "خطا در ثبت کاربر",
      error: error?.message || String(error),
    });
  }
});

app.get("/daily", async (req, res) => {
  try {
    const baseUUrl = process.env.GITLAB_BASE_URL;
    const projectId = process.env.GITLAB_PROJECT_ID;
    
    const targetDate = new Date().toISOString().slice(0, 10); 
    
    let allIssues = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const params = new URLSearchParams();
      params.set("per_page", String(perPage));
      params.set("page", String(page));

      params.set("state", "opened"); 

      const url = `${baseUUrl}/projects/${projectId}/issues?${params.toString()}`;
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
        },
      });
      if (!resp.ok) break;
      const batch = await resp.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      allIssues.push(...batch);
      if (batch.length < perPage) break;
      page++;
    }
    console.log("Fetched issues:", allIssues.length);
    

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
        chunk.map(async (issue) => {
          if (!issue.iid) return;
          
          const assignees = Array.isArray(issue.assignees)
            ? issue.assignees
            : [];
          const legacy = issue.assignee ? [issue.assignee] : [];
          const recipients = assignees.length > 0 ? assignees : legacy;

          
          const notesResp = await fetch(
            `${baseUUrl}/projects/${projectId}/issues/${issue.iid}/notes?system=true&per_page=100`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
              },
            },
          );
          let systemNotes = [];
          if (notesResp.ok) {
            systemNotes = await notesResp.json();
          }

          
          let hasAnyEventForIssueToday = false;
          const eventsResp = await fetch(
            `${baseUUrl}/projects/${projectId}/issues/${issue.iid}/resource_time_tracking_events?per_page=100`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
              },
            },
          );
          if (eventsResp.ok) {
            const events = await eventsResp.json();
            for (const ev of events) {
              const evDate = ev?.created_at
                ? new Date(ev.created_at).toISOString().slice(0, 10)
                : null;
              if (evDate !== targetDate) continue;
              const uid = ev?.user?.id;
              if (!uid) continue;
              const isAssignee = recipients.some((p) => p && p.id === uid);
              if (!isAssignee) continue;
              const delta = Number(ev.time_spent) || 0; 
              if (delta === 0) continue;
              hasAnyEventForIssueToday = true;

              if (!usersMap[uid]) {
                usersMap[uid] = {
                  userId: uid,
                  username: ev.user.username || "",
                  name: ev.user.name || "",
                  avatar_url: ev.user.avatar_url || "",
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
                  issue.labels.forEach((l) => usersMap[uid].labels.add(l));
                }
              }
              usersMap[uid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].activityLogs.push({
                type: "time_spent_changed",
                at: ev.created_at,
                by: uid,
                details: { seconds: delta },
                body: "",
              });
            }
          }

          
          if (Array.isArray(systemNotes) && systemNotes.length > 0) {
            for (const note of systemNotes) {
              if (!note?.body || !note?.created_at || !note?.author?.id)
                continue;
              const createdKey = new Date(note.created_at)
                .toISOString()
                .slice(0, 10);
              if (createdKey !== targetDate) continue; 
              const uid = note.author.id;
              const isAssignee = recipients.some((p) => p && p.id === uid);
              if (!isAssignee) continue;

              const raw = String(note.body);
              const m1 = raw.match(
                /deleted\s+(.+?)\s+of\s+spent\s+time\s+from\s+(\d{4}-\d{2}-\d{2})/i,
              );
              if (!m1) continue;
              const duration = m1[1];
              const fromDate = m1[2];
              if (fromDate !== targetDate) continue; 

              let seconds = 0;
              const unitRe2 = /(\d+)\s*(mo|w|d|h|m|s)\b/gi;
              let mm;
              while ((mm = unitRe2.exec(duration)) !== null) {
                const val = parseInt(mm[1], 10);
                const unit = mm[2].toLowerCase();
                if (Number.isNaN(val)) continue;
                const H = 3600;
                const D = 8 * H; 
                const W = 5 * D; 
                const MO = 4 * W; 
                if (unit === "mo") seconds += val * MO;
                else if (unit === "w") seconds += val * W;
                else if (unit === "d") seconds += val * D;
                else if (unit === "h") seconds += val * H;
                else if (unit === "m") seconds += val * 60;
                else if (unit === "s") seconds += val;
              }
              if (seconds === 0) continue;
              const delta = -seconds; 

              if (!usersMap[uid]) {
                usersMap[uid] = {
                  userId: uid,
                  username: note.author.username || "",
                  name: note.author.name || "",
                  avatar_url: note.author.avatar_url || "",
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
                  issue.labels.forEach((l) => usersMap[uid].labels.add(l));
                }
              }
              usersMap[uid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].activityLogs.push({
                type: "time_spent_changed",
                at: note.created_at,
                by: uid,
                details: { seconds: delta },
                body: raw,
              });
            }
          }

          
          if (
            !hasAnyEventForIssueToday &&
            Array.isArray(systemNotes) &&
            systemNotes.length > 0
          ) {
            for (const note of systemNotes) {
              if (!note?.body || !note?.created_at || !note?.author?.id)
                continue;
              const noteDate = new Date(note.created_at)
                .toISOString()
                .slice(0, 10);
              if (noteDate !== targetDate) continue;
              const body = String(note.body).toLowerCase();
              const isAdd =
                body.includes("added") && body.includes("time spent");
              const isSub =
                body.includes("subtracted") && body.includes("time spent");
              if (!isAdd && !isSub) continue;
              let seconds = 0;
              const unitRe = /(\d+)\s*(mo|w|d|h|m|s)\b/gi;
              let m;
              while ((m = unitRe.exec(body)) !== null) {
                const val = parseInt(m[1], 10);
                const unit = m[2].toLowerCase();
                if (Number.isNaN(val)) continue;
                const H = 3600;
                const D = 8 * H; 
                const W = 5 * D; 
                const MO = 4 * W; 
                if (unit === "mo") seconds += val * MO;
                else if (unit === "w") seconds += val * W;
                else if (unit === "d") seconds += val * D;
                else if (unit === "h") seconds += val * H;
                else if (unit === "m") seconds += val * 60;
                else if (unit === "s") seconds += val;
              }
              if (seconds === 0) continue;
              const uid = note.author.id;
              const isAssignee = recipients.some((p) => p && p.id === uid);
              if (!isAssignee) continue;

              const delta = isSub ? -seconds : seconds;

              if (!usersMap[uid]) {
                usersMap[uid] = {
                  userId: uid,
                  username: note.author.username || "",
                  name: note.author.name || "",
                  avatar_url: note.author.avatar_url || "",
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
                  issue.labels.forEach((l) => usersMap[uid].labels.add(l));
                }
              }
              usersMap[uid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].dailySpent += delta;
              usersMap[uid].issues[issue.iid].activityLogs.push({
                type: "time_spent_changed",
                at: note.created_at,
                by: uid,
                details: { seconds: delta },
                body: note.body,
              });
            }
          }

          
          const commentsResp = await fetch(
            `${baseUUrl}/projects/${projectId}/issues/${issue.iid}/notes?per_page=100`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
              },
            },
          );
          if (commentsResp.ok) {
            const comments = await commentsResp.json();
            for (const note of comments) {
              
              if (note?.system) continue;
              if (!note?.created_at || !note?.author?.id) continue;
              const noteDate = new Date(note.created_at)
                .toISOString()
                .slice(0, 10);
              if (noteDate !== targetDate) continue;
              const uid = note.author.id;
              const isAssignee = recipients.some((p) => p && p.id === uid);
              if (!isAssignee) continue;

              if (!usersMap[uid]) {
                usersMap[uid] = {
                  userId: uid,
                  username: note.author.username || "",
                  name: note.author.name || "",
                  avatar_url: note.author.avatar_url || "",
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
                  issue.labels.forEach((l) => usersMap[uid].labels.add(l));
                }
              }
              usersMap[uid].issues[issue.iid].commentsToday += 1;
              const lastEditedAt = note.last_edited_at || note.updated_at;
              const editor = note.last_edited_by || note.editor || note.author;
              if (lastEditedAt) {
                const editDate = new Date(lastEditedAt)
                  .toISOString()
                  .slice(0, 10);
                if (
                  editDate === targetDate &&
                  editor &&
                  editor.id === uid &&
                  note.created_at !== lastEditedAt
                ) {
                  usersMap[uid].issues[issue.iid].activityLogs.push({
                    type: "note_edited",
                    at: lastEditedAt,
                    by: uid,
                    details: { id: note.id },
                    body:
                      typeof note.body === "string"
                        ? note.body.slice(0, 200)
                        : "",
                  });
                }
              }
            }
          }
        }),
      );
    }
    
    for (const issue of allIssues) {
      const updatedDate = issue.updated_at
        ? new Date(issue.updated_at).toISOString().slice(0, 10)
        : null;
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
            issue.labels.forEach((l) => usersMap[uid].labels.add(l));
          }
        }
      }
    }
    console.log("Notes and updated issues processed");
    
    const results = Object.values(usersMap).map((u) => ({
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
      message: "خطا در تولید گزارش روزانه فعالیت کاربران",
      error: error?.message || String(error),
    });
  }
});


app.get("/activity-range", async (req, res) => {
  try {
    const baseUUrl = process.env.GITLAB_BASE_URL;
    const projectId = process.env.GITLAB_PROJECT_ID;
    const { users, from, to } = req.query;

    if (!projectId) {
      return res
        .status(400)
        .json({ message: "GITLAB_PROJECT_ID مشخص نشده است" });
    }
    if (!users || !from || !to) {
      return res
        .status(400)
        .json({ message: "پارامترهای users, from, to الزامی هستند" });
    }

    const userIds = String(users)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => Number(s))
      .filter((n) => !Number.isNaN(n));
    if (userIds.length === 0) {
      return res
        .status(400)
        .json({ message: "حداقل یک userId معتبر لازم است" });
    }

    
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return res.status(400).json({ message: "فرمت تاریخ از/تا نامعتبر است" });
    }
    const pad2 = (n) => String(n).padStart(2, "0");
    const toKey = (d) =>
      `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    const startKey = toKey(fromDate);
    const endKey = toKey(toDate);
    const isInRange = (isoDate) => isoDate >= startKey && isoDate <= endKey;

    
    let allIssues = [];
    const perPage = 100;
    {
      const params = new URLSearchParams();
      params.set("per_page", String(perPage));
      params.set("page", "1");
      params.set("state", "all");
      const firstUrl = `${baseUUrl}/projects/${projectId}/issues?${params.toString()}`;
      const firstResp = await fetch(firstUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
          Connection: "keep-alive",
        },
      });
      if (!firstResp.ok) {
        return res
          .status(500)
          .json({ message: "مشکل در گرفتن دیتا از GitLab" });
      }
      const firstBatch = await firstResp.json();
      if (Array.isArray(firstBatch) && firstBatch.length > 0) {
        allIssues.push(...firstBatch);
      }
      const totalPagesHeader = firstResp.headers.get("x-total-pages");
      const totalPages = totalPagesHeader
        ? parseInt(totalPagesHeader, 10)
        : null;
      if (totalPages && totalPages > 1) {
        const pageNumbers = Array.from(
          { length: totalPages - 1 },
          (_, i) => i + 2,
        );
        const pageResults = await Promise.all(
          pageNumbers.map(async (p) => {
            const pParams = new URLSearchParams();
            pParams.set("per_page", String(perPage));
            pParams.set("page", String(p));
            pParams.set("state", "all");
            const url = `${baseUUrl}/projects/${projectId}/issues?${pParams.toString()}`;
            const r = await fetch(url, {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
                Connection: "keep-alive",
              },
            });
            if (!r.ok) return [];
            const chunk = await r.json();
            return Array.isArray(chunk) ? chunk : [];
          }),
        );
        for (const arr of pageResults) allIssues.push(...arr);
      } else {
        
        let page = 2;
        while (true) {
          const params2 = new URLSearchParams();
          params2.set("per_page", String(perPage));
          params2.set("page", String(page));
          params2.set("state", "all");
          const url = `${baseUUrl}/projects/${projectId}/issues?${params2.toString()}`;
          const resp = await fetch(url, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
              Connection: "keep-alive",
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

    const usersMap = {};
    const limit = Math.max(
      1,
      Number(process.env.ACTIVITY_RANGE_CONCURRENCY || 5),
    );
    const chunkArray = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
      return out;
    };
    const issueChunks = chunkArray(allIssues, limit);

    for (const chunk of issueChunks) {
      await Promise.all(
        chunk.map(async (issue) => {
          if (!issue?.iid) return;
          const assignees = Array.isArray(issue.assignees)
            ? issue.assignees
            : [];
          const legacy = issue.assignee ? [issue.assignee] : [];
          const recipients = assignees.length > 0 ? assignees : legacy;

          
          const targetAssignees = recipients.filter(
            (p) => p && userIds.includes(Number(p.id)),
          );
          if (targetAssignees.length === 0) return; 

          
          const [sysNotesResp, notesResp] = await Promise.all([
            fetch(
              `${baseUUrl}/projects/${projectId}/issues/${issue.iid}/notes?system=true&per_page=100`,
              {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                  "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
                  Connection: "keep-alive",
                },
              },
            ),
            fetch(
              `${baseUUrl}/projects/${projectId}/issues/${issue.iid}/notes?per_page=100`,
              {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                  "PRIVATE-TOKEN": process.env.GITLAB_TOKEN,
                  Connection: "keep-alive",
                },
              },
            ),
          ]);

          
          if (sysNotesResp.ok) {
            const notes = await sysNotesResp.json();
            for (const note of notes) {
              if (!note?.body || !note?.created_at || !note?.author?.id)
                continue;
              const noteKey = new Date(note.created_at)
                .toISOString()
                .slice(0, 10);
              const authorId = Number(note.author.id);
              if (!userIds.includes(authorId)) continue;
              const isAssignee = recipients.some(
                (p) => p && Number(p.id) === authorId,
              );
              if (!isAssignee) continue;
              const body = String(note.body).toLowerCase();
              
              const delMatch = body.match(
                /deleted\s+(.+?)\s+of\s+spent\s+time\s+from\s+(\d{4}-\d{2}-\d{2})/i,
              );
              if (delMatch) {
                const duration = delMatch[1];
                const fromDateKey = delMatch[2];
                
                if (!isInRange(fromDateKey)) continue;
                let seconds = 0;
                const unitRe2 = /(\d+)\s*(mo|w|d|h|m|s)\b/gi;
                let m;
                const H = 3600;
                const D = 8 * H; 
                const W = 5 * D; 
                const MO = 4 * W; 
                while ((m = unitRe2.exec(duration)) !== null) {
                  const val = parseInt(m[1], 10);
                  const unit = m[2].toLowerCase();
                  if (Number.isNaN(val)) continue;
                  if (unit === "mo") seconds += val * MO;
                  else if (unit === "w") seconds += val * W;
                  else if (unit === "d") seconds += val * D;
                  else if (unit === "h") seconds += val * H;
                  else if (unit === "m") seconds += val * 60;
                  else if (unit === "s") seconds += val;
                }
                if (seconds === 0) continue;

                if (!usersMap[authorId]) {
                  usersMap[authorId] = {
                    userId: authorId,
                    username: note.author.username || "",
                    name: note.author.name || "",
                    avatar_url: note.author.avatar_url || "",
                    totalSpent: 0,
                    issues: {},
                    labels: new Set(),
                    byDate: {},
                  };
                }
                
                usersMap[authorId].totalSpent -= seconds;
                if (!usersMap[authorId].issues[issue.iid]) {
                  usersMap[authorId].issues[issue.iid] = {
                    iid: issue.iid,
                    title: issue.title,
                    labels: issue.labels,
                    time_stats: issue.time_stats,
                    milestone: issue.milestone,
                    created_at: issue.created_at,
                    updated_at: issue.updated_at,
                    spentInRange: 0,
                    commentsInRange: 0,
                    quality: {
                      hasTitle: Boolean(
                        issue.title && String(issue.title).trim().length > 0,
                      ),
                      hasDescription: Boolean(
                        issue.description &&
                          String(issue.description).trim().length > 0,
                      ),
                      labelsCount: Array.isArray(issue.labels)
                        ? issue.labels.length
                        : 0,
                      hasStatusLabel: Array.isArray(issue.labels)
                        ? issue.labels.some((l) => /status/i.test(String(l)))
                        : false,
                      estimateIsZero: !(
                        issue.time_stats &&
                        Number(issue.time_stats.time_estimate) > 0
                      ),
                      spentIsZero: !(
                        issue.time_stats &&
                        Number(issue.time_stats.total_time_spent) > 0
                      ),
                      spentEqualsEstimate: Boolean(
                        issue.time_stats &&
                          Number(issue.time_stats.time_estimate) > 0 &&
                          Number(issue.time_stats.total_time_spent) ===
                            Number(issue.time_stats.time_estimate),
                      ),
                      descriptionEditsInRange: 0,
                      largeOneOffSpends: [],
                    },
                  };
                  if (Array.isArray(issue.labels)) {
                    issue.labels.forEach((l) =>
                      usersMap[authorId].labels.add(l),
                    );
                  }
                }
                usersMap[authorId].issues[issue.iid].spentInRange -= seconds;
                
                usersMap[authorId].byDate[fromDateKey] =
                  (usersMap[authorId].byDate[fromDateKey] || 0) - seconds;
                continue;
              }

              
              if (!isInRange(noteKey)) continue;
              const isAdd =
                body.includes("added") && body.includes("time spent");
              const isSub =
                body.includes("subtracted") && body.includes("time spent");
              if (!isAdd && !isSub) continue;
              let seconds = 0;
              const unitRe = /(\d+)\s*(mo|w|d|h|m|s)\b/gi;
              let mm;
              const H = 3600;
              const D = 8 * H; 
              const W = 5 * D; 
              const MO = 4 * W; 
              while ((mm = unitRe.exec(body)) !== null) {
                const val = parseInt(mm[1], 10);
                const unit = mm[2].toLowerCase();
                if (Number.isNaN(val)) continue;
                if (unit === "mo") seconds += val * MO;
                else if (unit === "w") seconds += val * W;
                else if (unit === "d") seconds += val * D;
                else if (unit === "h") seconds += val * H;
                else if (unit === "m") seconds += val * 60;
                else if (unit === "s") seconds += val;
              }
              if (seconds === 0) continue;

              if (!usersMap[authorId]) {
                usersMap[authorId] = {
                  userId: authorId,
                  username: note.author.username || "",
                  name: note.author.name || "",
                  avatar_url: note.author.avatar_url || "",
                  totalSpent: 0,
                  issues: {},
                  labels: new Set(),
                  byDate: {},
                };
              }
              usersMap[authorId].totalSpent += isSub ? -seconds : seconds;
              if (!usersMap[authorId].issues[issue.iid]) {
                usersMap[authorId].issues[issue.iid] = {
                  iid: issue.iid,
                  title: issue.title,
                  labels: issue.labels,
                  time_stats: issue.time_stats,
                  milestone: issue.milestone,
                  created_at: issue.created_at,
                  updated_at: issue.updated_at,
                  spentInRange: 0,
                  commentsInRange: 0,
                  quality: {
                    hasTitle: Boolean(
                      issue.title && String(issue.title).trim().length > 0,
                    ),
                    hasDescription: Boolean(
                      issue.description &&
                        String(issue.description).trim().length > 0,
                    ),
                    labelsCount: Array.isArray(issue.labels)
                      ? issue.labels.length
                      : 0,
                    hasStatusLabel: Array.isArray(issue.labels)
                      ? issue.labels.some((l) => /status/i.test(String(l)))
                      : false,
                    estimateIsZero: !(
                      issue.time_stats &&
                      Number(issue.time_stats.time_estimate) > 0
                    ),
                    spentIsZero: !(
                      issue.time_stats &&
                      Number(issue.time_stats.total_time_spent) > 0
                    ),
                    spentEqualsEstimate: Boolean(
                      issue.time_stats &&
                        Number(issue.time_stats.time_estimate) > 0 &&
                        Number(issue.time_stats.total_time_spent) ===
                          Number(issue.time_stats.time_estimate),
                    ),
                    descriptionEditsInRange: 0,
                    largeOneOffSpends: [],
                  },
                };
                if (Array.isArray(issue.labels)) {
                  issue.labels.forEach((l) => usersMap[authorId].labels.add(l));
                }
              }
              usersMap[authorId].issues[issue.iid].spentInRange += isSub
                ? -seconds
                : seconds;
              
              usersMap[authorId].byDate[noteKey] =
                (usersMap[authorId].byDate[noteKey] || 0) +
                (isSub ? -seconds : seconds);
              
              if (isAdd && seconds >= 8 * 3600) {
                usersMap[authorId].issues[
                  issue.iid
                ].quality.largeOneOffSpends.push({
                  at: note.created_at,
                  seconds,
                });
              }
            }
          }

          
          if (notesResp.ok) {
            const notes = await notesResp.json();
            for (const note of notes) {
              if (note?.system) continue; 
              if (!note?.created_at || !note?.author?.id) continue;
              const noteKey = new Date(note.created_at)
                .toISOString()
                .slice(0, 10);
              if (!isInRange(noteKey)) continue;
              const authorId = Number(note.author.id);
              if (!userIds.includes(authorId)) continue;
              const isAssignee = recipients.some(
                (p) => p && Number(p.id) === authorId,
              );
              if (!isAssignee) continue;

              if (!usersMap[authorId]) {
                usersMap[authorId] = {
                  userId: authorId,
                  username: note.author.username || "",
                  name: note.author.name || "",
                  avatar_url: note.author.avatar_url || "",
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
                  labels: issue.labels,
                  time_stats: issue.time_stats,
                  milestone: issue.milestone,
                  created_at: issue.created_at,
                  updated_at: issue.updated_at,
                  spentInRange: 0,
                  commentsInRange: 0,
                  quality: {
                    hasTitle: Boolean(
                      issue.title && String(issue.title).trim().length > 0,
                    ),
                    hasDescription: Boolean(
                      issue.description &&
                        String(issue.description).trim().length > 0,
                    ),
                    labelsCount: Array.isArray(issue.labels)
                      ? issue.labels.length
                      : 0,
                    hasStatusLabel: Array.isArray(issue.labels)
                      ? issue.labels.some((l) => /status/i.test(String(l)))
                      : false,
                    estimateIsZero: !(
                      issue.time_stats &&
                      Number(issue.time_stats.time_estimate) > 0
                    ),
                    spentIsZero: !(
                      issue.time_stats &&
                      Number(issue.time_stats.total_time_spent) > 0
                    ),
                    spentEqualsEstimate: Boolean(
                      issue.time_stats &&
                        Number(issue.time_stats.time_estimate) > 0 &&
                        Number(issue.time_stats.total_time_spent) ===
                          Number(issue.time_stats.time_estimate),
                    ),
                    descriptionEditsInRange: 0,
                    largeOneOffSpends: [],
                  },
                };
                if (Array.isArray(issue.labels)) {
                  issue.labels.forEach((l) => usersMap[authorId].labels.add(l));
                }
              }
              usersMap[authorId].issues[issue.iid].commentsInRange += 1;
              
              const lastEditedAt = note.last_edited_at || note.updated_at;
              const editor = note.last_edited_by || note.editor || note.author;
              if (lastEditedAt) {
                const editKey = new Date(lastEditedAt)
                  .toISOString()
                  .slice(0, 10);
                if (
                  isInRange(editKey) &&
                  editor &&
                  Number(editor.id) === authorId &&
                  note.created_at !== lastEditedAt
                ) {
                  const bodyStr =
                    typeof note.body === "string"
                      ? note.body.toLowerCase()
                      : "";
                  if (
                    bodyStr.includes("description") ||
                    bodyStr.includes("edited") ||
                    bodyStr.includes("changed")
                  ) {
                    usersMap[authorId].issues[
                      issue.iid
                    ].quality.descriptionEditsInRange += 1;
                  }
                }
              }
            }
          }
        }),
      );
    }

    
    for (const issue of allIssues) {
      const updatedKey = issue.updated_at
        ? new Date(issue.updated_at).toISOString().slice(0, 10)
        : null;
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
            labels: issue.labels,
            time_stats: issue.time_stats,
            milestone: issue.milestone,
            updated_at: issue.updated_at,
            spentInRange: 0,
            commentsInRange: 0,
          };
          if (Array.isArray(issue.labels)) {
            issue.labels.forEach((l) => usersMap[uid].labels.add(l));
          }
        }
      }
    }

    
    for (const issue of allIssues) {
      const createdKey = issue.created_at
        ? new Date(issue.created_at).toISOString().slice(0, 10)
        : null;
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
            labels: issue.labels,
            time_stats: issue.time_stats,
            milestone: issue.milestone,
            updated_at: issue.updated_at,
            spentInRange: 0,
            commentsInRange: 0,
          };
          if (Array.isArray(issue.labels)) {
            issue.labels.forEach((l) => usersMap[uid].labels.add(l));
          }
        }
      }
    }

    
    for (const u of Object.values(usersMap)) {
      let totalIssueCount = 0;
      let realnessSum = 0; 
      let suspiciousIssueCount = 0; 
      
      const dailyKeys = Object.keys(u.byDate || {}).sort();
      const daily = dailyKeys.map((k) => ({
        date: k,
        spent: u.byDate[k] || 0,
      }));
      const H = 3600;
      const targetDailyMax = 7.5 * H; 
      const minHealthy = 5 * H; 
      let daysBelowMin = 0;
      let daysAboveTarget = 0;
      for (const d of daily) {
        if (d.spent < minHealthy) daysBelowMin += 1;
        if (d.spent > targetDailyMax) daysAboveTarget += 1;
      }
      for (const iss of Object.values(u.issues)) {
        const q = iss.quality || {};
        const reasons = [];
        if (q.hasTitle === false) reasons.push("missing_title");
        if (q.hasDescription === false) reasons.push("missing_description");
        if (q.spentEqualsEstimate === true)
          reasons.push("spent_equals_estimate");
        if (q.spentIsZero === true) reasons.push("no_spent");
        if (q.estimateIsZero === true) reasons.push("no_estimate");
        if ((q.labelsCount || 0) <= 3) reasons.push("few_labels");
        if (q.hasStatusLabel === false) reasons.push("missing_status_label");
        if ((q.descriptionEditsInRange || 0) >= 3)
          reasons.push("many_description_edits");
        const hasBigOneOff =
          Array.isArray(q.largeOneOffSpends) && q.largeOneOffSpends.length > 0;
        if (hasBigOneOff) reasons.push("large_one_off_spend");

        
        const estimate = Number(iss?.time_stats?.time_estimate) || 0;
        const totalSpent = Number(iss?.time_stats?.total_time_spent) || 0;
        const spentInRange = Number(iss?.spentInRange) || 0;
        q.spentToEstimateRatio =
          estimate > 0 ? Number(totalSpent / estimate).toFixed(2) : null;
        q.hasBigOneOffSpend = hasBigOneOff;
        iss.quality = q;

        
        let score = 1.0;
        const subtract = (v) => (score = Math.max(0, score - v));
        const add = (v) => (score = Math.min(1, score + v));
        
        if (q.hasTitle === false) subtract(0.12);
        if (q.hasDescription === false) subtract(0.12);
        if (q.spentEqualsEstimate === true) subtract(0.18);
        if (q.spentIsZero === true) subtract(0.12);
        if (q.estimateIsZero === true) subtract(0.12);
        if ((q.labelsCount || 0) <= 3) subtract(0.06);
        if (q.hasStatusLabel === false) subtract(0.06);
        if ((q.descriptionEditsInRange || 0) >= 3) subtract(0.12);
        if (hasBigOneOff) subtract(0.18);
        
        if (daysBelowMin > 0) subtract(Math.min(0.2, 0.02 * daysBelowMin));
        if (daysAboveTarget > 0) add(Math.min(0.15, 0.015 * daysAboveTarget));
        
        if (spentInRange > 0) add(0.08);
        if ((iss?.commentsInRange || 0) > 0)
          add(Math.min(0.08, 0.02 * iss.commentsInRange));
        if (estimate > 0 && totalSpent > 0) {
          const ratio = totalSpent / estimate;
          if (ratio >= 0.6 && ratio <= 1.4) add(0.05);
        }

        iss.realnessScore = Number(score.toFixed(2));
        iss.suspiciousReasons = reasons;
        totalIssueCount += 1;
        realnessSum += score;
        if (reasons.length > 0) suspiciousIssueCount += 1;
      }
      u.totalIssueCount = totalIssueCount;
      u.suspiciousIssueCount = suspiciousIssueCount;
      u.realnessPercent =
        totalIssueCount > 0
          ? Number((realnessSum / totalIssueCount) * 100).toFixed(2)
          : 100;
      
      const toHM = (s) => {
        const sec = Math.round(Number(s) || 0);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        return `${h}h ${m}m`;
      };
      u.dailySummary = daily.map((d) => ({
        date: d.date,
        spent: d.spent,
        spent_hm: toHM(d.spent),
      }));
      u.daysBelowMin = daysBelowMin;
      u.daysAboveTarget = daysAboveTarget;
      u.overtime = daysAboveTarget > 0;
    }

    const results = Object.values(usersMap).map((u) => ({
      userId: u.userId,
      username: u.username,
      name: u.name,
      avatar_url: u.avatar_url,
      totalSpent: u.totalSpent || 0,
      realnessPercent: u.realnessPercent,
      suspiciousIssueCount: u.suspiciousIssueCount,
      totalIssueCount: u.totalIssueCount,
      overtime: u.overtime,
      daysBelowMin: u.daysBelowMin,
      daysAboveTarget: u.daysAboveTarget,
      dailySummary: u.dailySummary,
      issues: Object.values(u.issues),
      labels: Array.from(u.labels),
    }));

    res.json(results);
  } catch (error) {
    res.status(500).json({
      message: "خطا در تولید گزارش بازه‌ای فعالیت کاربران",
      error: error?.message || String(error),
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
