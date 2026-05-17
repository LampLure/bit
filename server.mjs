import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserRuntimeStatus, runBrowserSearch } from './browserRuntime.mjs';
import { fetchTorrentMetadata, torrentMetadataStatus } from './torrentMetadataService.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const distDir = resolve(__dirname, 'dist');
const dataDir = resolve(__dirname, 'data');
const cookieFile = join(dataDir, 'cookies.json');
const port = Number(process.env.PORT ?? 4173);
const maxHtmlBytes = 4 * 1024 * 1024;
const requestTimeoutMs = 20_000;

/** @type {Record<string, Record<string, string>>} */
let cookieJar = {};

async function loadCookieJar() {
  try {
    cookieJar = JSON.parse(await readFile(cookieFile, 'utf8'));
  } catch {
    cookieJar = {};
  }
}

async function saveCookieJar() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(cookieFile, JSON.stringify(cookieJar, null, 2));
}

function hostKey(url) {
  return new URL(url).host;
}

function cookieHeader(url) {
  const cookies = cookieJar[hostKey(url)] ?? {};
  return Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ');
}

function rememberCookies(url, headers) {
  const setCookie = headers.getSetCookie?.() ?? [];
  if (setCookie.length === 0) return;
  const host = hostKey(url);
  cookieJar[host] ??= {};
  for (const cookie of setCookie) {
    const [pair] = cookie.split(';');
    const separator = pair.indexOf('=');
    if (separator > 0) cookieJar[host][pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }
}

function detectCloudflare(html, title = '') {
  return /just a moment|cf-browser-verification|cf-challenge|cloudflare|checking your browser/i.test(`${title}\n${html}`);
}

function extractTitle(html) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
}

async function fetchRemotePage(rawUrl) {
  const target = new URL(rawUrl);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Only http/https URLs are supported');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const cookies = cookieHeader(target.href);
    const response = await fetch(target.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 BitResourceFinder/0.2 metadata-only local app',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...(cookies ? { cookie: cookies } : {}),
      },
    });
    rememberCookies(response.url, response.headers);
    await saveCookieJar();
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxHtmlBytes) throw new Error('Remote page is larger than the configured limit');
      chunks.push(value);
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    const title = extractTitle(html);
    return {
      url: response.url,
      status: response.status,
      ok: response.ok,
      title,
      html,
      cloudflareDetected: detectCloudflare(html, title),
      cookieHosts: Object.keys(cookieJar).length,
    };
  } finally {
    clearTimeout(timeout);
  }
}


async function readJsonBody(req, limitBytes = 1024 * 1024) {
  const chunks = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > limitBytes) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const filePath = normalize(join(distDir, requested));
  if (!filePath.startsWith(distDir) || !existsSync(filePath)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

await loadCookieJar();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (url.pathname === '/api/health') {
      json(res, 200, { ok: true, cookieHosts: Object.keys(cookieJar).length });
      return;
    }
    if (url.pathname === '/api/fetch') {
      const target = url.searchParams.get('url');
      if (!target) {
        json(res, 400, { ok: false, error: 'Missing url parameter' });
        return;
      }
      json(res, 200, await fetchRemotePage(target));
      return;
    }
    if (url.pathname === '/api/browser/status') {
      json(res, 200, await browserRuntimeStatus());
      return;
    }
    if (url.pathname === '/api/browser/search' && req.method === 'POST') {
      const body = await readJsonBody(req);
      json(res, 200, await runBrowserSearch(body));
      return;
    }
    if (url.pathname === '/api/torrent/status') {
      json(res, 200, await torrentMetadataStatus());
      return;
    }
    if (url.pathname === '/api/torrent/metadata' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.magnetUri) {
        json(res, 400, { ok: false, error: 'Missing magnetUri' });
        return;
      }
      json(res, 200, await fetchTorrentMetadata(body.magnetUri, body.timeoutMs));
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}).listen(port, () => {
  console.log(`Bit Resource Finder running at http://127.0.0.1:${port}`);
});
