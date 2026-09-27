import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import duolingo from './api/duolingo.js';
import duolingoNudge from './api/duolingo-nudge.js';
import githubContributions from './api/github-contributions.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

function withJsonResponse(response) {
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return {
      json(body) {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(body));
        return response;
      },
      send(body) {
        response.end(body);
        return response;
      }
    };
  };
  return response;
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/api/duolingo') return duolingo(request, withJsonResponse(response));
  if (url.pathname === '/api/duolingo-nudge') return duolingoNudge(request, withJsonResponse(response));
  if (url.pathname === '/api/github-contributions') return githubContributions(request, withJsonResponse(response));
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    return response.end();
  }

  const requestedPath = url.pathname === '/' ? 'index.html' : url.pathname;
  const filePath = normalize(join(root, decodeURIComponent(requestedPath)));
  const relativePath = relative(root, filePath);
  // dotfiles (.env, .git) hold secrets and history, never site content
  if (relativePath.startsWith('..') || isAbsolute(relativePath) || relativePath.split(/[\\/]/).some((part) => part.startsWith('.'))) {
    response.writeHead(403);
    return response.end();
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' });
    return response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    response.writeHead(404);
    return response.end('Not found');
  }
}).listen(port, () => console.log(`Portfolio running at http://localhost:${port}`));
