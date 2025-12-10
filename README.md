## GitLab Report Backend
- API مبتنی بر Express برای جمع‌آوری گزارش‌های GitLab (مایلستون، لیبل، زمان، گزارش روزانه) با JWT و MongoDB برای مدیریت کاربران.
- تنظیمات و وابستگی‌ها در `docs/configuration.md` مستند شده‌اند؛ خطاها و جریان‌های عملیاتی در `docs/operations.md` آمده‌اند.
- برای آشنایی با معماری، نمودار و سطح اندپوینت‌ها را در `docs/architecture.md` ببینید.
- اجرای سریع: `npm install` → تنظیم `.env` → `npm start` (پورت پیش‌فرض 9005) یا Docker با `docker build -t gitlab-report-backend .`.

