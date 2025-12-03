# Architecture (Estateir Frontend)

## هدف این پروژه

این پروژه فرانت‌اند وب‌سایت عمومی estateir است:

- معرفی خدمات و برند
- صفحات درباره ما / تماس با ما
- فرم ثبت درخواست (call request)
- نمایش اطلاعات ملک‌ها (صفحه جزئیات ملک)

## نمای کلی

- Next.js App Router
- داده‌ها از طریق API بک‌اند دریافت می‌شوند (Base URL از env)
- برخی درخواست‌ها Server-Side انجام می‌شود (برای SEO/SSR و کنترل کش)
- برخی فرم‌ها Client-Side هستند (به‌خصوص call-request)


# دیاگرام سطح بالا (Mermaid)

```mermaid
flowchart LR
  U["کاربر/مرورگر"] -->|HTTP| FE_APP["Next.js Frontend (estateir.com)"]
  FE_APP -->|fetch/SSR| API["Backend API (NEXT_PUBLIC_BACKEND_API)"]
  FE_APP -->|assets| CDN["Static/Public Assets"]
  FE_APP -->|Redirect/Link| DASH["Dashboard (dashboard.*)"]
  FE_APP -->|Optional| GA["Analytics/Tags"]

  subgraph FE_INTERNALS["Frontend internals"]
    MW["middleware: locale routing"]
    R["Routes: app/(public)"]
    L["Layouts + Providers"]
    C["Components"]
    S["Services: myFetch/axios"]
  end
```
