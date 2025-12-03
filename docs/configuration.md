
# Configuration

## فایل‌های env
این ریپو چند env نمونه دارد:
- `.env.local` (برای لوکال)
- `.env.test` (برای محیط تست)
- `.env.prod` (برای پرود)


نکته: در Next.js معمولاً `.env.production` شناخته‌شده‌تر از `.env.prod` است. اگر در CI/Deployment از مکانیزم استاندارد Next استفاده می‌کنید، بهتر است نام‌گذاری envها با استاندارد Next هم‌راستا باشد.

## متغیرهای محیطی (ENV Vars)
### 1) NEXT_PUBLIC_BACKEND_API (ضروری)
Base URL بک‌اند:
- نمونه prod: `https://api.estateir.com/api/v1`
- نمونه test: `https://api.akbari.devrc.ir/api/v1`

اثر مستقیم:
- سرویس‌های fetch/auth/call-request و دانلود تصاویر از همین استفاده می‌کنند.

### 2) NEXT_PUBLIC_DEBUG (پیشنهادی)
- اگر  `"True"` باشد، روی برخی صفحات `robots: noindex` فعال می‌شود.
- برای production باید `"False"` باشد تا صفحات ایندکس شوند.

### 3) NEXT_PUBLIC_IS_TEST (وابسته به منو/داشبورد)
در `LayoutPublic` برای تعیین لینک داشبورد:
- `"TRUE"` → `dashboard.akbari.devrc.ir`
- `"False"` → `dashboard.estateir.com`


## i18n و فایل‌های محتوا
ترجمه‌ی صفحات عمومی از JSONهای `public/i18n/` می‌آید:
- home/about/contact/call-request/layout

الگو:
- `public/i18n/<page>/{locale}.json`
- locale های اصلی: `fa`, `en`, `ar`

## SEO Config
در برخی صفحات، مقدار `BASE = "https://estateir.com"` هاردکد شده و برای:
- canonical
- openGraph
- logo URL
استفاده می‌شود.

اگر staging دامنه‌ی متفاوت دارد، پیشنهاد:
- یا یک env جداگانه مثل `NEXT_PUBLIC_SITE_BASE_URL` تعریف و در کد جایگزین شود
- یا در فرایند build برای هر محیط مقدار BASE را مدیریت کنید.

## Configuration فایل‌ها / جایگاه‌ها
- Routing و locale: `src/middleware.js`
- Layout عمومی: `src/app/layout.js`
- Layout صفحات عمومی چندزبانه: `src/app/(public)/[locale]/layout.js`
- سرویس‌ها و API clients: `src/services/`

## چک‌لیست سریع قبل از build
- [ ] `NEXT_PUBLIC_BACKEND_API` درست است
- [ ] `NEXT_PUBLIC_DEBUG` برای prod = False
- [ ] فایل‌های ترجمه‌ی `public/i18n/...` کامل هستند
- [ ] (در صورت نیاز) `NEXT_PUBLIC_IS_TEST` درست تنظیم شده است
