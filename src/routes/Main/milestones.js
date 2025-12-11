'use strict';

import { baseUUrl, token, projectId } from '../../config.js';

export default async (req, res) => {
    try {
        const response = await fetch(`${baseUUrl}/projects/${projectId}/milestones`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'PRIVATE-TOKEN': token,
            },
        });

        if (!response.ok) {
            return res.json({
                status: 'err',
            });
        }

        const data = await response.json();
        res.json({
            data: data,
        });
    } catch (error) {
        console.log(45);
        res.status(500).json({
            message: 'Failed to fetch milestones report',
            error: error?.message || String(error),
        });
    }
};
