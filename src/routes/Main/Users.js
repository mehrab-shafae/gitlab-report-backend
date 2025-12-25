// #### --> MRB <-- ### //
'use strict';

import { baseUUrl, token } from '../../config.js';

export default async (req, res) => {
  const response = await fetch(`${baseUUrl}/users`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': token,
    },
  });

  const data = await response.json();
  console.log(data);

  const activeUser = data.filter(user => {
    if (user.state) {
      return true;
    } else {
      return false;
    }
  });

  res.json({
    status: 'success',
    data: activeUser,
  });
};
// #### --> MRB <-- ### //
// *** MRB *** //
