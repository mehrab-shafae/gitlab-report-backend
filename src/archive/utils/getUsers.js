const getUsers = async function getUsers() {
  const baseUUrl = process.env.GITLAB_BASE_URL;

  const response = await fetch(`${baseUUrl}/users`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': process.env.GITLAB_TOKEN,
    },
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
};

export default getUsers;
