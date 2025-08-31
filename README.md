# GitLab Proxy (Logging Enabled)

این نسخه مخصوص تست است و لاگ مفصل از درخواست‌ها و پاسخ‌های GitLab چاپ می‌کند.

## راه‌اندازی
```bash
npm ci
cp .env.example .env
# مقادیر را در .env ست کنید (GITLAB_TOKEN و ...)
npm start
```

## تست سریع
- سلامت:
```bash
curl http://localhost:3001/healthz
```
- هویت (بررسی توکن):
```bash
curl http://localhost:3001/debug/gitlab/whoami
```
- تست پروکسی پروژه‌ها:
```bash
curl "http://localhost:3001/api/gitlab/projects?membership=true&per_page=5"
```

در ترمینال، لاگ‌هایی مثل زیر می‌بینید:
```
[INCOMING] {"method":"GET","url":"/api/gitlab/projects?membership=true&per_page=5", ...}
[UPSTREAM][REQ] GET https://git.forvestlab.ir/api/v4/projects?membership=true&per_page=5
[UPSTREAM][RES] 200 application/json; charset=utf-8 len=1234
[UPSTREAM][BODY<=400] [{"id":..., "name":"..."} ...]
```

> اگر 401/403 گرفتید، اسکوپ‌های توکن یا URL پایه را چک کنید.
