import { baseUUrl, token, perPage, projectId } from '../../config.js';

export default async (req, res) => {
      try {
            let andLabels = [];
            if (req.query.labels) {
                  if (Array.isArray(req.query.labels)) {
                        andLabels = req.query.labels;
                  } else if (typeof req.query.labels === 'string') {
                        andLabels = req.query.labels
                              .split(',')
                              .map(l => l.trim())
                              .filter(Boolean);
                  }
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
                  if (!nextPageHeader || nextPageHeader === '0' || chunk.length < perPage) break;

                  page = parseInt(nextPageHeader, 10) || page + 1;
            }

            if (andLabels.length > 0) {
                  let issues = [];
                  let issuePage = 1;
                  while (true) {
                        const issueParams = new URLSearchParams({
                              per_page: String(perPage),
                              page: String(issuePage),
                              state: 'all',
                        });
                        const issuesUrl = `${baseUUrl}/projects/${encodeURIComponent(projectId)}/issues?${issueParams.toString()}`;
                        const issuesResp = await fetch(issuesUrl, {
                              method: 'GET',
                              headers: {
                                    'Content-Type': 'application/json',
                                    'PRIVATE-TOKEN': token,
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

                        if (andLabels.every(l => issue.labels.includes(l))) {
                              for (const l of issue.labels) {
                                    labelSet.add(l);
                              }
                        }
                  }

                  const filteredLabels = allLabels.filter(lbl => labelSet.has(lbl.name));
                  return res.json({ status: 'success', data: filteredLabels });
            }

            res.json({ status: 'success', data: allLabels });
      } catch (e) {
            res.status(500).json({
                  message: 'Failed to fetch labels',
                  error: e?.message || String(e),
            });
      }
};
