
import { weights } from './ActivityRange/config.js';

			const H = 3600;

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
            
export default function(req, usersMap, workingDateKeys) {
for (const u of Object.values(usersMap)) {
			try {
				const byDatePreview = Object.entries(u.byDate || {}).slice(0, 10);
				console.log('[summary][aggregate][user]', {
					userId: u.userId,
					username: u.username,
					totalIssues: Object.keys(u.issues || {}).length,
					totalSpentPreview: Object.values(u.byDate || {}).reduce((a, b) => a + b, 0),
					byDatePreview,
				});
			} catch (e) {}
			let totalIssueCount = 0;
			// let realnessSum = 0;
			let suspiciousIssueCount = 0;

			for (const u of Object.values(usersMap)) {
				if (!u.byDate) u.byDate = {};
				if (!u.issues) u.issues = {};
			}

			const daily = workingDateKeys.map(k => {
				const issueList = Object.values(u.issues || {});
				const issuesArr = issueList.map(iss => ({ iid: iss.iid, spent: (iss.byDate && iss.byDate[k]) || 0 })).filter(x => x.spent !== 0);

				const totalForDay = issueList.reduce((sum, iss) => {
					return sum + (iss.byDate && iss.byDate[k] ? Number(iss.byDate[k]) : 0);
				}, 0);

				return {
					date: k,
					spent: totalForDay,
					issues: issuesArr,
					issueIids: issuesArr.map(it => it.iid),
				};
			});

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
			// پس از اعمال fallback، totalEstimate را از روی خلاصه نهایی روزانه محاسبه کن
			const totalEstimateFinal = estimateDaily.reduce((s, d) => s + (d.estimate || 0), 0);
			u.totalEstimate = totalEstimateFinal;
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

}