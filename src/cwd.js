import path from 'path';

function cwd(resolvePath, join) {
      const resolvedPath = path.resolve(process.cwd(), resolvePath || '');
      return join ? path.join(resolvedPath, join) : resolvedPath;
}

global.cwd = cwd;
