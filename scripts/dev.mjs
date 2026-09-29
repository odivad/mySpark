// Development mode: `npm run dev`.
// - Rebuilds the app on every source change (tsc --watch on tsconfig.app.json).
// - Serves web/ on http://localhost:8767/ (localhost only).
// - Tells open pages to reload when anything in web/ changes, over /__dev/events (server-sent events).
// No dependencies beyond Node and the TypeScript already in devDependencies.
import { spawn } from 'node:child_process';
import { createReadStream, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const WEB = join(ROOT, 'web');
const PORT = Number(process.env.PORT ?? 8767);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

/* --- live reload ------------------------------------------------------ */

const clients = new Set();
let timer;
function changed(file) {
  clearTimeout(timer);
  // tsc writes several files per rebuild: wait for it to finish.
  timer = setTimeout(() => {
    console.log(`[dev] changed: ${file ?? 'web/'} — notifying ${clients.size} page(s)`);
    for (const res of clients) res.write('event: reload\ndata: {}\n\n');
  }, 300);
}
watch(WEB, { recursive: true }, (_event, file) => {
  if (file && file.endsWith('.map')) return;
  changed(file);
});

/* --- static server ---------------------------------------------------- */

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/__dev/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('event: hello\ndata: {}\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  // Resolve inside web/ only; refuse anything that escapes it.
  let file = normalize(join(WEB, decodeURIComponent(url.pathname)));
  if (file !== WEB && !file.startsWith(WEB + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    statSync(file);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev] mySpark on http://localhost:${PORT}/  (Ctrl+C to stop)`);
});

/* --- compiler --------------------------------------------------------- */

const tsc = spawn(
  process.execPath,
  [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.app.json', '--watch', '--preserveWatchOutput'],
  { cwd: ROOT, stdio: 'inherit' },
);
const stop = () => {
  tsc.kill();
  server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
