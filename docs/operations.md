# Runbook — GitLab Report Backend (فشرده و خطاها EN+FA)

شروع سریع محلی:
- `npm install`
- `npm run build` (اگر TypeScript)
- اجرا: `npm start` یا `node index.js`

خطاهای رایج (EN — FA — راه‌حل):

- GitLab API connection failed
  - English: Cannot reach GitLab or auth failed
  - فارسی: اتصال GitLab یا اعتبارسنجی ناموفق
  - حل: بررسی GITLAB_API_TOKEN, GITLAB_URL, network

- Excel export memory error
  - English: ExcelJS ran out of memory
  - فارسی: حافظه برای export Excel کافی نیست
  - حل: batch processing، کاهش بخش export

- MongoDB query failed
  - English: Report data retrieval error
  - فارسی: خطا هنگام بازیابی دادهٔ گزارش
  - حل: بررسی MONGO_URI, query syntax


مسئول‌ها: MRB, Forest Backend Team
