import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { createDashboardService, forecastBases, observationBase, number, normalizeAir, normalizeForecast, normalizeRestaurants, scoreFor, unpack, REGIONS, goldenTime, restaurantLocation } from '../lib/dashboard.mjs';

const samples = JSON.parse(await readFile(new URL('../samples/dashboard.json', import.meta.url), 'utf8'));
const now = () => new Date('2026-10-16T05:20:00Z');
const good = items => Response.json({ response: { header: { resultCode: '00' }, body: { totalCount: items.length, items: { item: items } } } });
const air = ['마포구', '용산구', '종로구'].map(stationName => ({ stationName, mangName: '도시대기', pm10Value: '25', pm25Value: '12', dataTime: '2026-10-16 14:00' }));
function forecast() {
  return [16, 17, 18].flatMap(day => [16, 17, 18, 19, 20, 21, 22].flatMap(hour => Object.entries({ TMP: '21', POP: '0', PTY: '0', SKY: '1' }).map(([category, fcstValue]) => ({
    category, fcstValue, fcstDate: `202610${day}`, fcstTime: `${hour}00`,
  }))));
}
const fixtureFetch = async url => {
  if (url.pathname.endsWith('getVilageFcst')) return good(forecast());
  if (url.pathname.endsWith('getUltraSrtNcst')) return good([{ category: 'T1H', obsrValue: '23' }, { category: 'REH', obsrValue: '50' }, { category: 'WSD', obsrValue: '2.1' }]);
  if (url.pathname.endsWith('getCtprvnRltmMesureDnsty')) return good(air);
  const area = url.searchParams.get('cond[ROAD_NM_ADDR::LIKE]');
  return good([{ BPLC_NM: '테스트 업소', ROAD_NM_ADDR: `${area} 테스트로 1`, SALS_STTS_CD: '01', DTL_SALS_STTS_CD: '01', BZSTAT_SE_NM: '한식', DAT_UPDT_PNT: '2026-10-15 22:00:00' }]);
};
async function setup(fetchImpl = fixtureFetch, envText = 'API_KEY=TEST_KEY_NOT_A_REAL_CREDENTIAL') {
  const dir = await mkdtemp(join(tmpdir(), 'yajang-tests-'));
  const envPath = join(dir, '.env');
  if (envText !== null) await writeFile(envPath, envText);
  const service = createDashboardService({ samples, envPath, fetchImpl, now, timeoutMs: 20 });
  return { service, envPath };
}

test('빈 미세먼지 값과 결측 기호를 0으로 바꾸지 않습니다', () => {
  for (const value of [null, undefined, '', ' ', '-', 'NaN', '-1']) assert.equal(number(value, 0), null);
  assert.equal(number('0', 0), 0);
  assert.equal(scoreFor(21, 0, 10, 5), 100);
  assert.ok(scoreFor(21, 100, 10, 5, 1) <= 50);
  assert.ok(scoreFor(21, 0, 151, 76) < scoreFor(21, 0, 30, 15));
});
test('발표 지연·자정·저녁에도 오늘 16시 예보를 요청합니다', () => {
  assert.deepEqual(forecastBases(new Date('2026-10-15T15:05:00Z'))[0], { date: '20261015', time: '1400' });
  assert.deepEqual(forecastBases(new Date('2026-10-15T17:10:00Z'))[0], { date: '20261015', time: '2300' });
  assert.deepEqual(forecastBases(new Date('2026-10-16T14:30:00Z'))[0], { date: '20261016', time: '1400' });
  assert.deepEqual(observationBase(new Date('2026-10-15T15:20:00Z')), { date: '20261015', time: '2300' });
});
test('미제공 날짜는 비워 두고 오늘 필수 예보 누락을 감지합니다', () => {
  const days = normalizeForecast(forecast(), '2026-10-16');
  assert.equal(days.length, 5);
  assert.equal(days[0].hours.length, 7);
  assert.equal(days[3].available, false);
  assert.throws(() => normalizeForecast(forecast().filter(item => item.category !== 'POP'), '2026-10-16'));
});
test('지정 지역 관측소만 사용하며 결측·점검·오래된 관측은 제외합니다', () => {
  assert.equal(normalizeAir(air, REGIONS.seoul_mapo, now()).pm10, 25);
  for (const change of [{ pm10Value: '-' }, { pm25Flag: '점검 중' }, { dataTime: '2026-10-15 12:00' }]) {
    assert.throws(() => normalizeAir([{ ...air[0], ...change }], REGIONS.seoul_mapo, now()));
  }
});
test('폐업·타 지역 업소를 제외하고 인허가 영업 상태를 표시합니다', () => {
  const row = { BPLC_NM: '업소', ROAD_NM_ADDR: '서울특별시 마포구 도로 1', SALS_STTS_CD: '01' };
  const rows = normalizeRestaurants([row, { ...row, SALS_STTS_CD: '03' }, { ...row, ROAD_NM_ADDR: '부산광역시' }], REGIONS.seoul_mapo, 'restaurant');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, '영업/정상');
});
test('HTTP 200 안의 API 인증 오류를 성공으로 처리하지 않습니다', () => {
  assert.throws(() => unpack({ response: { header: { resultCode: '30' } } }), /30/);
});
test('인증키 없는 파일과 없는 .env 모두 네트워크 호출 없이 전체 샘플로 전환합니다', async () => {
  for (const envText of [null, '', 'API_KEY=']) {
    let calls = 0;
    const { service } = await setup(async () => { calls++; throw new Error('unexpected'); }, envText);
    const data = await service('seoul_mapo');
    assert.equal(data.mode, 'sample');
    assert.equal(calls, 0);
    assert.equal(data.hourly.length, 7);
    assert.ok(data.restaurants.length > 0);
    assert.ok(data.restaurants.every(row => row.sample));
    assert.match(data.warnings[0], /인증키가 없습니다/);
  }
});
test('배포 서버의 비밀 설정으로 데이터를 읽고 키 변경·누락 시 캐시를 갱신합니다', async () => {
  let key = 'HOSTED_TEST_KEY';
  let calls = 0;
  const service = createDashboardService({ samples, configProvider: () => ({ API_KEY:key }), now,
    fetchImpl: async url => { calls++; assert.equal(url.searchParams.get('serviceKey'),key); return fixtureFetch(url); } });
  const live = await service('seoul_mapo');
  assert.equal(live.mode,'live');
  assert.ok(!JSON.stringify(live).includes(key));
  assert.equal(calls,5);
  key = 'ROTATED_HOSTED_TEST_KEY';
  assert.equal((await service('seoul_mapo')).mode,'live');
  assert.equal(calls,10);
  key = '';
  assert.equal((await service('seoul_mapo')).mode,'sample');
  assert.equal(calls,10);
});
test('실제 응답 형식을 기존 화면 구조로 변환하고 캐시를 공유합니다', async () => {
  let calls = 0;
  const { service } = await setup(async url => { calls++; return fixtureFetch(url); });
  const data = await service('seoul_mapo');
  assert.equal(data.mode, 'live');
  assert.equal(data.currentTemp, '23°C');
  assert.equal(data.wind, '2.1m/s');
  assert.equal(data.score, 100);
  assert.equal(data.weekly[4].score, null);
  assert.equal(data.restaurants.length, 2);
  assert.equal(data.sources.restaurant.reference, '2026-10-15 22:00:00');
  await service('seoul_mapo');
  assert.equal(calls, 5);
});
test('API 리다이렉트를 따라가지 않고 인증키를 다른 서버로 전달하지 않습니다', async () => {
  const { service } = await setup(async (url, options) => {
    assert.equal(url.hostname, 'apis.data.go.kr');
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://example.com/' } });
  });
  const data = await service('seoul_mapo');
  assert.equal(data.mode, 'sample');
  assert.match(data.sources.weather.reason, /HTTP 302/);
  assert.ok(!JSON.stringify(data).includes('TEST_KEY_NOT_A_REAL_CREDENTIAL'));
});

test('지수는 16~22시 일곱 시간 모두를 반영합니다', async () => {
  const { service } = await setup(async url => {
    if (!url.pathname.endsWith('getVilageFcst')) return fixtureFetch(url);
    return good(forecast().map(item => item.fcstTime === '1600' && item.category === 'TMP' ? { ...item, fcstValue:'0' } : item));
  });
  const data = await service('seoul_mapo');
  assert.equal(data.hourly[0].time,'16:00');
  assert.equal(data.score,94);
  assert.equal(data.weekly[0].score,93);
});
test('골든타임은 연속 세 시점의 최고 평균이며 동점은 빠른 시간대입니다', () => {
  const hours = [16,17,18,19,20,21,22].map((h,i)=>({time:`${h}:00`,score:[50,60,90,100,90,70,60][i]}));
  const best = goldenTime(hours);
  assert.deepEqual(best.hours,['18:00','19:00','20:00']);
  assert.equal(best.label,'18–20시');
  assert.equal(best.recommended,true);
  assert.equal(goldenTime(hours.map(h=>({...h,score:30}))).recommended,false);
  assert.equal(goldenTime([hours[0],hours[3],hours[6]]),null);
});
test('실제 인허가 좌표를 서울 위경도로 변환하고 결측·범위 밖 좌표를 제외합니다', () => {
  const point=restaurantLocation('193404.219098261','451054.271435844');
  assert.ok(point && point.lat>37.55 && point.lat<37.58 && point.lng>126.91 && point.lng<126.94);
  for (const [x,y] of [['',451054],[0,0],['bad',0],[159674,-27485]]) assert.equal(restaurantLocation(x,y),null);
});
test('카페·주점 필터용 분류는 실제 업태에 근거합니다',()=>{
  const row={BPLC_NM:'테스트',ROAD_NM_ADDR:'서울특별시 마포구 테스트로',SALS_STTS_CD:'01',BZSTAT_SE_NM:'호프/통닭'};
  assert.equal(normalizeRestaurants([row],REGIONS.seoul_mapo,'restaurant')[0].category,'pub');
  assert.equal(normalizeRestaurants([{...row,BZSTAT_SE_NM:'커피숍'}],REGIONS.seoul_mapo,'cafe')[0].category,'cafe');
});
test('일부 API 실패 시 성공한 영역은 실제 데이터로 유지합니다', async () => {
  const { service } = await setup(async url => url.pathname.includes('rest_cafes') ? new Response('failure', { status: 503 }) : fixtureFetch(url));
  const data = await service('seoul_mapo');
  assert.equal(data.mode, 'mixed');
  assert.equal(data.sources.cafe.mode, 'sample');
  assert.equal(data.sources.weather.mode, 'live');
  assert.equal(data.scoreSample, false);
  assert.ok(data.restaurants.some(row => row.sample));
  assert.ok(data.restaurants.some(row => !row.sample));
});
test('대기 결측 시 실제 날씨를 유지하고 지수에 샘플 포함을 표시합니다', async () => {
  const { service } = await setup(async url => url.pathname.includes('Rltm') ? good([{ ...air[0], pm10Value: '-' }]) : fixtureFetch(url));
  const data = await service('seoul_mapo');
  assert.equal(data.scoreSample, true);
  assert.equal(data.sources.weather.mode, 'live');
  assert.equal(data.sources.air.mode, 'sample');
  assert.equal(data.weekly[0].sample, false);
});
test('인증 오류·XML 오류·연결 실패도 화면용 샘플을 반환합니다', async () => {
  for (const fetcher of [
    async () => Response.json({ response: { header: { resultCode: '30' } } }),
    async () => new Response('<OpenAPI_ServiceResponse>ERROR</OpenAPI_ServiceResponse>'),
    async () => { throw new Error('network unavailable'); },
  ]) {
    const { service } = await setup(fetcher);
    assert.equal((await service('seoul_all')).mode, 'sample');
  }
});
test('시간 초과 후 모든 요청을 종료하고 샘플로 복구합니다', async () => {
  const timer = setTimeout(() => {}, 1000);
  try {
    const { service } = await setup((url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    assert.equal((await service('seoul_all')).mode, 'sample');
  } finally { clearTimeout(timer); }
});
test('인코딩된 키는 한 번만 인코딩하고 기존 키 이름도 지원합니다', async () => {
  const { service } = await setup(async url => {
    assert.equal(url.searchParams.get('serviceKey'), 'TEST+/=');
    return fixtureFetch(url);
  }, 'DATA_GO_KR_API_KEY=TEST%2B%2F%3D');
  assert.equal((await service('seoul_mapo')).mode, 'live');
});
test('실제 데이터가 캐시되어 있어도 인증 파일 제거 시 즉시 샘플로 전환합니다', async () => {
  const { service, envPath } = await setup();
  assert.equal((await service('seoul_mapo')).mode, 'live');
  await unlink(envPath); // 테스트 전용 임시 파일입니다. 원본 .env에는 접근하지 않습니다.
  assert.equal((await service('seoul_mapo')).mode, 'sample');
});
test('공공데이터 도메인 밖으로 인증키를 전송하지 않습니다', async () => {
  let weatherCalls = 0;
  const { service } = await setup(async url => {
    assert.equal(url.hostname, 'apis.data.go.kr');
    if (url.pathname.includes('Fcst')) weatherCalls++;
    return fixtureFetch(url);
  }, 'API_KEY=TEST_KEY\nVILAGE_FCST_ENDPOINT=https://example.com');
  const data = await service('seoul_mapo');
  assert.equal(data.sources.weather.mode, 'sample');
  assert.equal(weatherCalls, 0);
});
test('로컬 서버는 지정된 화면 자산만 제공하고 내부 파일·잘못된 지역을 차단합니다', async t => {
  const { envPath } = await setup();
  const server = await createApp({ envPath, fetchImpl: fixtureFetch, now });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin)).status, 200);
  for (const [path, mime] of [['/assets/dashboard.css','text/css'],['/assets/dashboard.js','text/javascript'],['/vendor/leaflet.css','text/css'],['/vendor/leaflet.js','text/javascript']]) {
    const asset = await fetch(origin + path);
    assert.equal(asset.status,200);
    assert.ok(asset.headers.get('content-type').startsWith(mime));
  }
  for (const path of ['/.env', '/PRD.md', '/AGENTS.md', '/samples/dashboard.json', '/lib/dashboard.mjs', '/node_modules/proj4/package.json', '/assets/../.env', '/api/dashboard?region=invalid']) {
    assert.ok([400, 404].includes((await fetch(origin + path)).status));
  }
  assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
  const response = await fetch(origin + '/api/dashboard?region=seoul_mapo');
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.ok(!text.includes('TEST_KEY_NOT_A_REAL_CREDENTIAL'));
  assert.equal(JSON.parse(text).mode, 'live');
});
