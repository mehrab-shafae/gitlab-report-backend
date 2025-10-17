
import { baseUUrl, token, perPage, projectId } from '../../../config.js';
import { NOTES_CONCURRENCY } from './config.js';

export default async function() {
    try{

    let allIssues = [];
            {
                const params = new URLSearchParams();
                params.set('per_page', String(perPage));
                params.set('page', '1');
                params.set('state', 'all');
                const firstUrl = `${baseUUrl}/projects/${projectId}/issues?${params.toString()}`;
                const firstResp = await fetch(firstUrl, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'PRIVATE-TOKEN': token,
                        Connection: 'keep-alive',
                    },
                });
                if (!firstResp.ok) {
                    throw new Error('مشکل در گرفتن دیتا از GitLab');
                }
                const firstBatch = await firstResp.json();
                if (Array.isArray(firstBatch) && firstBatch.length > 0) {
                    allIssues.push(...firstBatch);
                }
                const totalPagesHeader = firstResp.headers.get('x-total-pages');
                const totalPages = totalPagesHeader ? parseInt(totalPagesHeader, 10) : null;
                if (totalPages && totalPages > 1) {
                    const pageNumbers = Array.from({ length: totalPages - 1 }, (_, i) => i + 2);
                    const pageResults = await Promise.all(
                        pageNumbers.map(async p => {
                            const pParams = new URLSearchParams();
                            pParams.set('per_page', String(perPage));
                            pParams.set('page', String(p));
                            pParams.set('state', 'all');
                            const url = `${baseUUrl}/projects/${projectId}/issues?${pParams.toString()}`;
                            const r = await fetch(url, {
                                method: 'GET',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'PRIVATE-TOKEN': token,
                                    Connection: 'keep-alive',
                                },
                            });
                            if (!r.ok) return [];
                            const chunk = await r.json();
                            return Array.isArray(chunk) ? chunk : [];
                        })
                    );
                    for (const arr of pageResults) allIssues.push(...arr);
                } else {
                    let page = 2;
                    while (true) {
                        const params2 = new URLSearchParams();
                        params2.set('per_page', String(perPage));
                        params2.set('page', String(page));
                        params2.set('state', 'all');
                        const url = `${baseUUrl}/projects/${projectId}/issues?${params2.toString()}`;
                        const resp = await fetch(url, {
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                                'PRIVATE-TOKEN': token,
                                Connection: 'keep-alive',
                            },
                        });
                        if (!resp.ok) break;
                        const batch = await resp.json();
                        if (!Array.isArray(batch) || batch.length === 0) break;
                        allIssues.push(...batch);
                        if (batch.length < perPage) break;
                        page++;
                    }
                }
            }
    
            try {
                console.log('[issue][pre] users:', userIds.join(','), 'range:', startKey, 'to', endKey);
                console.log('[issue][pre] fetched issues count:', allIssues.length);
                const sampleIssueIds = allIssues
                    .slice(0, 10)
                    .map(it => it && it.iid)
                    .filter(Boolean);
                console.log('[issue][pre] sample issue IIDs:', sampleIssueIds.join(', '));
            } catch (e) {}
    
            const limit = Math.max(1, NOTES_CONCURRENCY);
            const chunkArray = (arr, size) => {
                const out = [];
                for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
                return out;
            };
            const issueChunks = chunkArray(allIssues, limit);
    return issueChunks;
        }catch(e){
            console.error('[issue] error:', e)
throw new Error(e);
        }
}
