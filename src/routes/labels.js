import express from 'express';

export const labelsRouter = express.Router();

labelsRouter.get('/', async (req, res) => {
	try {
		const baseUUrl = process.env.GITLAB_BASE_URL;
		const token = process.env.GITLAB_TOKEN;
		const projectId = req.query.projectId || process.env.GITLAB_PROJECT_ID;

		if (!baseUUrl || !token) {
			return res.status(500).json({ message: 'GITLAB_BASE_URL یا GITLAB_TOKEN ست نشده است' });
		}
		if (!projectId) {
			return res.status(400).json({ message: 'projectId مشخص نیست (query یا .env)' });
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
			const perPage = Number(params.get('per_page')) || 100;
			if (!nextPageHeader || nextPageHeader === '0' || chunk.length < perPage) break;

			page = parseInt(nextPageHeader, 10) || page + 1;
		}

		res.json({ status: 'success', data: allLabels });
	} catch (e) {
		res.status(500).json({ message: 'Failed to fetch labels', error: e?.message || String(e) });
	}
});


