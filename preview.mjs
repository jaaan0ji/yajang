import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// 기존 index.html만 제공하는 Node.js 설치 확인용 미리보기 서버입니다.
const pagePath = new URL('./index.html', import.meta.url);
const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (request.url !== '/' && request.url !== '/index.html') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('요청하신 파일을 찾을 수 없습니다.');
    return;
  }
  try {
    const page = await readFile(pagePath);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : page);
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('화면 파일을 읽지 못했습니다.');
  }
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? '3000번 포트가 사용 중입니다. 기존 서버를 종료한 뒤 다시 실행해 주세요.'
    : `서버를 시작하지 못했습니다: ${error.code}`);
  process.exitCode = 1;
});
server.listen(3000, '127.0.0.1', () => {
  console.log('대시보드 미리보기: http://127.0.0.1:3000');
  console.log('현재 화면은 기존 샘플 데이터입니다. 종료하려면 Ctrl+C를 누르세요.');
});
