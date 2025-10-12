import ExcelJS from 'exceljs';

export default async function(results){
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
}