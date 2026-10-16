import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createDashboardService, REGIONS } from './lib/dashboard.mjs';

export async function createApp({ envPath = new URL('./.env', import.meta.url), fetchImpl = fetch, now, timeoutMs } = {}) {
  const samples = JSON.parse(await readFile(new URL('./samples/dashboard.json', import.meta.url), 'utf8'));
  const dashboard = createDashboardService({ samples, envPath, fetchImpl, now, timeoutMs });
  return createServer(async (request, response) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method)) { response.setHeader('Allow', 'GET, HEAD'); return send(405, JSON.stringify({ error: '지원하지 않는 요청입니다.' })); }
    let url;
    try { url = new URL(request.url, 'http://localhost'); } catch { return send(400, '{"error":"잘못된 요청입니다."}'); }
    if (url.pathname === '/api/dashboard') {
      const region = url.searchParams.get('region') || 'seoul_all';
      if (!Object.hasOwn(REGIONS, region)) return send(400, JSON.stringify({ error: '지원하지 않는 지역입니다.' }));
      try { return send(200, JSON.stringify(await dashboard(region))); }
      catch { return send(500, JSON.stringify({ error: '데이터를 불러오지 못했습니다. 샘플 데이터를 표시해 주세요.' })); }
    }
    const files = { '/': 'index.html', '/index.html': 'index.html',
      '/assets/dashboard.css': 'assets/dashboard.css', '/assets/dashboard.js': 'assets/dashboard.js',
      '/vendor/leaflet.css': 'node_modules/leaflet/dist/leaflet.css', '/vendor/leaflet.js': 'node_modules/leaflet/dist/leaflet.js' };
    if (!Object.hasOwn(files, url.pathname)) return send(404, '요청하신 파일을 찾을 수 없습니다.', 'text/plain; charset=utf-8');
    const mime = url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : url.pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
    try { return send(200, await readFile(new URL(files[url.pathname], import.meta.url)), mime); }
    catch { return send(500, '화면 파일을 읽지 못했습니다.', 'text/plain; charset=utf-8'); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const portArg = process.argv.find(arg => arg.startsWith('--port='));
  const envArg = process.argv.find(arg => arg.startsWith('--env-file='));
  const port = Number(portArg?.slice(7) || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('포트는 1~65535 사이의 숫자로 지정해 주세요.');
  const server = await createApp(envArg ? { envPath: resolve(envArg.slice(11)) } : {});
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `${port}번 포트가 사용 중입니다. 기존 서버를 종료해 주세요.` : '서버를 시작하지 못했습니다.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`야장 대시보드: http://localhost:${port}`);
    console.log('종료하려면 이 터미널에서 Ctrl+C를 누르세요.');
  });
}
