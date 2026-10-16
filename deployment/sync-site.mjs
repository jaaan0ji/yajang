import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 기존 Sites 체크아웃에 공개 가능한 파일만 복사합니다. .env와 Git 이력은 건드리지 않습니다.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, process.argv[2] || '.deployment/yajang');
if (target === root) throw new Error('배포용 Sites 체크아웃 폴더를 지정해 주세요.');
const expected = JSON.parse(await readFile(join(root, 'deployment/hosting.json'), 'utf8'));
const actual = JSON.parse(await readFile(join(target, '.openai/hosting.json'), 'utf8'));
if (expected.project_id !== actual.project_id) throw new Error('다른 사이트의 체크아웃에는 복사할 수 없습니다.');
const files = [
  ['index.html', 'ui/index.html'],
  ['assets/dashboard.css', 'public/assets/dashboard.css'],
  ['assets/dashboard.js', 'public/assets/dashboard.js'],
  ['lib/dashboard.mjs', 'lib/dashboard.mjs'],
  ['samples/dashboard.json', 'samples/dashboard.json'],
  ['deployment/home-route.ts', 'app/route.ts'],
  ['deployment/dashboard-route.ts', 'app/api/dashboard/route.ts'],
  ['deployment/layout.tsx', 'app/layout.tsx'],
  ['node_modules/leaflet/dist/leaflet.css', 'public/vendor/leaflet.css'],
  ['node_modules/leaflet/dist/leaflet.js', 'public/vendor/leaflet.js'],
  ['node_modules/leaflet/LICENSE', 'public/vendor/leaflet-LICENSE.txt'],
];
for (const [source, destination] of files) {
  const output = join(target, destination);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(join(root, source), output);
}
await mkdir(join(target, 'app/index.html'), { recursive: true });
await writeFile(join(target, 'app/index.html/route.ts'), 'export { GET } from "../route";\n');
console.log(`공개 소스 ${files.length + 1}개를 기존 사이트 체크아웃에 동기화했습니다.`);
