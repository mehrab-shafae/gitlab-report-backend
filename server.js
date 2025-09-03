// Node 18+ (global fetch) - GitLab proxy with verbose logging for testing
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
// --- Load .env robustly (override any existing envs) ---
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env'), override: true });
// --------------------------------------------------------

const app = express();


// ===== Config =====
const PORT = process.env.PORT || 3001;
const ALLOW_ORIGINS = (process.env.ALLOW_ORIGINS || 'http://localhost:5173,http://localhost:3001')
  .split(',').map(s => s.trim()).filter(Boolean);
const GITLAB_BASE = (process.env.GITLAB_BASE || 'https://gitlab.com/api/v4').replace(/\/$/, '');
const GITLAB_TOKEN = process.env.GITLAB_TOKEN; // PAT or OAuth service token
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15000);
const LOG_BODY = String(process.env.LOG_BODY || '0') === '1'; // log small response bodies

// ===== Middleware =====
app.use(morgan(':method :url :status :res[content-length] - :response-time ms'));
app.use(express.json({ limit: '2mb' }));

// Custom basic logger (without sensitive headers)
app.use((req, _res, next) => {
  const { method, originalUrl } = req;
  const hasBody = !['GET','HEAD'].includes(method);
  const info = {
    method,
    url: originalUrl,
    hasBody,
    query: req.query,
    // NEVER log Authorization/Private-Token from client
  };
  console.log('[INCOMING]', JSON.stringify(info));
  next();
});

// Controlled CORS
// app.use(cors({
//   origin(origin, cb) {
//     if (!origin || ALLOW_ORIGINS.includes(origin)) return cb(null, true);
//     return cb(new Error('Origin not allowed by CORS'), false);
//   },
//   credentials: true,
//   methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
//   allowedHeaders: ['Content-Type','Authorization','Private-Token'],
// }));
// app.options(['http://localhost:5174'], cors());
  app.use(cors({
      origin : ['http://localhost:5174' , 'https://gitlabreport.forvestlab.ir' ] ,
      credentials : true ,
  }));


// Health check
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Quick debug endpoint to verify token: calls /user
app.get('/debug/gitlab/whoami', async (req, res) => {
  try {
    const headers = new Headers();
    if (GITLAB_TOKEN) {
      headers.set('Private-Token', GITLAB_TOKEN);
      // or headers.set('Authorization', `Bearer ${GITLAB_TOKEN}`);
    }
    const r = await fetch(GITLAB_BASE + '/user', { headers });
    const text = await r.text();
    console.log('[UPSTREAM][whoami]', r.status, text.slice(0, 400));
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (e) {
    console.error('[UPSTREAM][whoami][ERR]', e);
    res.status(502).json({ error: 'proxy_error', detail: String(e?.message || e) });
  }
});

// ===== GitLab proxy =====
app.all('/api/gitlab/*', async (req, res) => {
  try {
    // Build target URL safely
    const original = new URL(req.originalUrl, 'http://local'); // dummy base
    const upstreamPath = original.pathname.replace(/^\/api\/gitlab/, '');
    const target = new URL(GITLAB_BASE + upstreamPath);
    target.search = original.searchParams.toString();

    // Prepare headers from server env (do not trust client auth)
    const headers = new Headers();
    if (GITLAB_TOKEN) {
      headers.set('Private-Token', GITLAB_TOKEN);
      // If using OAuth instead:
      // headers.set('Authorization', `Bearer ${GITLAB_TOKEN}`);
    }
    if (req.headers['content-type']) {
      headers.set('Content-Type', req.headers['content-type']);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    const options = {
      method: req.method,
      headers,
      signal: controller.signal
    };
    if (!['GET','HEAD'].includes(req.method)) {
      options.body = JSON.stringify(req.body ?? {});
    }

    console.log('[UPSTREAM][REQ]', req.method, target.toString());

    const upstream = await fetch(target, options);
    clearTimeout(timeout);

    const contentType = upstream.headers.get('content-type') || 'application/json; charset=utf-8';
    const arrBuf = await upstream.arrayBuffer();
    const buf = Buffer.from(arrBuf);

    console.log('[UPSTREAM][RES]', upstream.status, contentType, `len=${buf.length}`);
    if (LOG_BODY) {
      const preview = buf.toString('utf-8', 0, Math.min(400, buf.length));
      console.log('[UPSTREAM][BODY<=400]', preview);
    }

    res.set({
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization,Private-Token,Content-Type',
      'Content-Type': contentType,
    });

    res.status(upstream.status).send(buf);
  } catch (err) {
    const isAbort = err && (err.name === 'AbortError');
    console.error('[UPSTREAM][ERR]', isAbort ? 'timeout' : 'error', err?.message || err);
    res.status(502).json({ error: isAbort ? 'upstream_timeout' : 'proxy_error', detail: String(err?.message || err) });
  }
});


app.listen(process.env.PORT || 3001, '0.0.0.0', () => {
  console.log('Listening on 0.0.0.0:' + (process.env.PORT || 3001));
  console.log('Config:', {
    GITLAB_BASE: process.env.GITLAB_BASE,
    hasToken: Boolean(process.env.GITLAB_TOKEN),
    LOG_BODY: String(process.env.LOG_BODY)
  });
  if (!process.env.GITLAB_BASE || /gitlab\.com\/api\/v4/i.test(process.env.GITLAB_BASE)) {
    console.warn('[WARN] GITLAB_BASE looks wrong:', process.env.GITLAB_BASE);
  }
});
