# معماری — GitLab Report Backend (فشرده)

سرویس تولید گزارش‌های GitLab Milestones. Excel export و مدیریت milestone‌ها.

دیاگرام:
```mermaid
flowchart LR
  Client -->|HTTP| Report["Report<br/>Backend"]
  Report -->|Query| GitLab["GitLab<br/>API"]
  Report --> Mongo["MongoDB"]
  Report -->|Export| ExcelJS["ExcelJS"]
```

فایل‌های مهم: `index.js`/`app.ts`, `package.json`, `swagger.yaml` (در صورت وجود), مدل‌های Mongoose, middleware‌های custom.
