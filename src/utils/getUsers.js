
const getUsers = async function getUsers(){
	const baseUUrl = process.env.GITLAB_BASE_URL;

	const response = await fetch(`${baseUUrl}/users`, {
		method: 'GET',
		headers: { 
			'Content-Type': 'application/json' ,
			'PRIVATE-TOKEN': 'glpat-gKYtYiZmcyyVYuzz9yUZ'
		},
	});


	const data = await response.json();

	return data
}

export default getUsers;