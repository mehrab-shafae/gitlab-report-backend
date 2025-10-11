export const ALL_PROJECT_IDS = [];
// export const projectNameCache = {};

export const baseUUrl = process.env.GITLAB_BASE_URL;
export const token = process.env.GITLAB_TOKEN;
export const projectId = process.env.GITLAB_PROJECT_ID;
export const groupId = process.env.GITLAB_GROUP_ID;
export const port = process.env.PORT || 3000;
export const perPage = 100; //, 50, 100
export const adminUser = process.env.adminUser || 'master';
export const JWT_SECRET = process.env.JWT_SECRET || 'fdffdsasd4343';
export const DEV_MODE = process.env.DEV_MODE === 'true';

if (DEV_MODE) {
      console.log('🔧 Development mode is ENABLED - Token validation bypassed');
}

export const originsC = ['http://localhost:3000', 'http://localhost:3001', process.env.originsCors];

if (!baseUUrl || !token) {
      throw new Error('GITLAB_BASE_URL یا GITLAB_TOKEN ست نشده است');
}
if (!projectId) {
      throw new Error('projectId مشخص نیست (query یا .env)');
}
