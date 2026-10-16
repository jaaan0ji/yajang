import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import proj4 from 'proj4';

const KOREAN_TM = '+proj=tmerc +lat_0=38 +lon_0=127.002890277778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +towgs84=-145.907,505.034,685.756,-1.162,2.347,1.592,6.342 +units=m +no_defs';
export const HOURS = [16, 17, 18, 19, 20, 21, 22];
export function restaurantLocation(x, y) {
  if (number(x) === null || number(y) === null) return null;
  try {
    const [lng, lat] = proj4(KOREAN_TM, 'EPSG:4326', [Number(x), Number(y)]);
    return lat >= 37.4 && lat <= 37.75 && lng >= 126.7 && lng <= 127.25 ? { lat, lng } : null;
  } catch { return null; }
}
export function goldenTime(hourly) {
  let best = null;
  for (let i = 0; i <= hourly.length - 3; i++) {
    const window = hourly.slice(i, i + 3);
    if (window.some(h => !Number.isFinite(h.score))) continue;
    if (window.some((h, index) => index && Number(h.time.slice(0, 2)) !== Number(window[index - 1].time.slice(0, 2)) + 1)) continue;
    const score = window.reduce((sum, h) => sum + h.score, 0) / 3;
    if (!best || score > best.score) best = { start: window[0].time, end: window[2].time, score, hours: window.map(h => h.time) };
  }
  return best ? { ...best, score: Math.round(best.score), recommended: best.score >= 80, label: `${Number(best.start.slice(0, 2))}–${Number(best.end.slice(0, 2))}시` } : null;
}

export const REGIONS = {
  seoul_all: { name: '서울특별시 전체', address: '서울특별시', nx: 60, ny: 127, station: null, weatherPoint: '서울 대표 격자(60,127)' },
  seoul_mapo: { name: '서울특별시 마포구', address: '서울특별시 마포구', nx: 59, ny: 127, station: '마포구', weatherPoint: '마포구 대표 격자(59,127)' },
  seoul_yongsan: { name: '서울특별시 용산구', address: '서울특별시 용산구', nx: 60, ny: 126, station: '용산구', weatherPoint: '용산구 대표 격자(60,126)' },
  seoul_jongno: { name: '서울특별시 종로구', address: '서울특별시 종로구', nx: 60, ny: 127, station: '종로구', weatherPoint: '종로구 대표 격자(60,127)' },
};
export const SOURCES = {
  weather: '기상청 단기예보', current: '기상청 초단기실황', air: '에어코리아 대기오염정보',
  restaurant: '행정안전부 일반음식점', cafe: '행정안전부 휴게음식점',
};
const ENDPOINTS = {
  weather: 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0',
  air: 'https://apis.data.go.kr/B552584/ArpltnInforInqireSvc',
  restaurant: 'https://apis.data.go.kr/1741000/general_restaurants',
  cafe: 'https://apis.data.go.kr/1741000/rest_cafes',
};
const OFFSET = 9 * 3600000;
export const kstText = (now = new Date()) => new Date(+now + OFFSET).toISOString().slice(0, 16).replace('T', ' ');
export const compactDate = (date) => date.replaceAll('-', '');
export const referenceText = (date, time) => `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(2)}`;
export function addDays(date, offset) {
  return new Date(Date.parse(date + 'T00:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
}
export function dayLabel(date) {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8))} (${'일월화수목금토'[new Date(date + 'T00:00:00Z').getUTCDay()]})`;
}
export function number(value, min = -Infinity, max = Infinity) {
  if (value === null || value === undefined || String(value).trim() === '' || value === '-') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
const average = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const round = (n) => Math.round(n * 10) / 10;
export function grade(pm, fine = false) {
  const bounds = fine ? [15, 35, 75] : [30, 80, 150];
  return pm <= bounds[0] ? 0 : pm <= bounds[1] ? 1 : pm <= bounds[2] ? 2 : 3;
}
export function weatherPoints(temp, rain, precipitation = 0) {
  const deviation = temp < 18 ? 18 - temp : temp > 24 ? temp - 24 : 0;
  const points = Math.max(0, 40 - deviation * 5) + 40 * (1 - rain / 100);
  return precipitation > 0 ? Math.min(points, 30) : points;
}
export function scoreFor(temp, rain, pm10, pm25, precipitation = 0) {
  return Math.round(weatherPoints(temp, rain, precipitation) + [20, 14, 4, 0][Math.max(grade(pm10), grade(pm25, true))]);
}
export const scoreLabel = (score) => score >= 80 ? '야외 활동을 추천드려요' : score >= 60 ? '날씨를 확인해 주세요' : '실내 이용을 권해 드려요';

// 오늘 16시 예보를 보존하기 위해 14시보다 늦은 발표본은 선택하지 않습니다.
export function forecastBases(now = new Date()) {
  const local = new Date(+now + OFFSET - 15 * 60000);
  const date = local.toISOString().slice(0, 10);
  const hour = local.getUTCHours();
  const candidates = [14, 11, 8, 5, 2].filter(h => h <= hour)
    .map(h => ({ date: compactDate(date), time: `${String(h).padStart(2, '0')}00` }));
  candidates.push({ date: compactDate(addDays(date, -1)), time: '2300' });
  return candidates.slice(0, 2);
}
export function observationBase(now = new Date()) {
  const local = new Date(+now + OFFSET - 45 * 60000);
  return { date: compactDate(local.toISOString().slice(0, 10)), time: `${String(local.getUTCHours()).padStart(2, '0')}00` };
}
export function unpack(json) {
  const header = json?.response?.header;
  if (!header || !['0', '00', '0000'].includes(String(header.resultCode))) {
    const code = String(header?.resultCode ?? '형식 오류').replace(/[^0-9A-Za-z가-힣 _-]/g, '').slice(0, 30);
    throw new Error(`API 응답 오류(${code})입니다. 활용신청과 호출 한도를 확인해 주세요.`);
  }
  const body = json.response.body;
  if (!body || typeof body !== 'object') throw new Error('API 응답에 데이터 본문이 없습니다.');
  const raw = body.items?.item ?? body.items;
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Object.keys(raw).length ? [raw] : [];
  return { items, totalCount: number(body.totalCount, 0) ?? items.length };
}
export function normalizeForecast(items, today) {
  const slots = new Map();
  for (const item of items) {
    if (!/^\d{8}$/.test(item.fcstDate) || !/^\d{4}$/.test(item.fcstTime)) continue;
    const date = `${item.fcstDate.slice(0, 4)}-${item.fcstDate.slice(4, 6)}-${item.fcstDate.slice(6)}`;
    const id = `${date} ${item.fcstTime}`;
    const slot = slots.get(id) || { date, time: `${item.fcstTime.slice(0, 2)}:${item.fcstTime.slice(2)}` };
    slot[item.category] = item.fcstValue;
    slots.set(id, slot);
  }
  const days = Array.from({ length: 5 }, (_, index) => {
    const date = addDays(today, index);
    const hours = HOURS.map(hour => {
      const slot = slots.get(`${date} ${hour}00`);
      if (!slot) return null;
      const temp = number(slot.TMP, -60, 60), rain = number(slot.POP, 0, 100);
      const precipitation = number(slot.PTY, 0, 7), sky = number(slot.SKY, 1, 4);
      if ([temp, rain, precipitation, sky].includes(null)) return null;
      return { time: slot.time, temp, rain, precipitation, sky: ({ 1: '맑음', 3: '구름 많음', 4: '흐림' })[sky] || '하늘 상태 확인 필요' };
    });
    return { date, hours, available: hours.every(Boolean) };
  });
  if (!days[0].available) throw new Error('오늘 16~22시 예보가 충분하지 않습니다.');
  return days;
}
export function normalizeAir(items, region, now = new Date()) {
  const relevant = items.filter(item => region.station ? item.stationName === region.station : item.mangName === '도시대기');
  const valid = relevant.filter(item => {
    const age = +now - Date.parse(String(item.dataTime).replace(' ', 'T') + ':00+09:00');
    return age >= -3600000 && age <= 3 * 3600000 && number(item.pm10Value, 0, 2000) !== null
      && number(item.pm25Value, 0, 2000) !== null && !item.pm10Flag && !item.pm25Flag;
  });
  if (!valid.length) throw new Error('최근 3시간 이내의 유효한 미세먼지 관측값이 없습니다.');
  return {
    pm10: round(average(valid.map(i => Number(i.pm10Value)))),
    pm25: round(average(valid.map(i => Number(i.pm25Value)))),
    reference: valid.map(i => i.dataTime).sort()[0],
    location: region.station || `서울 도시대기 ${valid.length}개 측정소 평균`,
  };
}
export function normalizeRestaurants(items, region, kind) {
  const unique = new Map();
  for (const item of items) {
    const address = item.ROAD_NM_ADDR || item.LOTNO_ADDR || '';
    if (item.SALS_STTS_CD !== '01' || (item.DTL_SALS_STTS_CD && item.DTL_SALS_STTS_CD !== '01') || item.CLSBIZ_YMD) continue;
    if (!address.startsWith(region.address) || !item.BPLC_NM) continue;
    unique.set(item.MNG_NO || `${item.BPLC_NM}|${address}`, {
      name: item.BPLC_NM, type: `${kind === 'cafe' ? '휴게음식점' : '일반음식점'}${item.BZSTAT_SE_NM ? ` · ${item.BZSTAT_SE_NM}` : ''}`,
      address, feature: '인허가 정보 기준', status: '영업/정상',
      category: kind === 'cafe' ? 'cafe' : /호프|소주방|정종|대포집|선술집|주점|맥주/.test(item.BZSTAT_SE_NM || '') ? 'pub' : 'restaurant',
      location: restaurantLocation(item.CRD_INFO_X, item.CRD_INFO_Y),
      licensedStatus: '인허가상 영업/정상', source: kind, sample: false, updatedAt: item.DAT_UPDT_PNT || item.LAST_MDFCN_PNT || null,
    });
  }
  return [...unique.values()].slice(0, 6);
}

export function createDashboardService({ samples, envPath, configProvider, fetchImpl = fetch, now = () => new Date(), timeoutMs = 20000 }) {
  const cache = new Map();
  let keyFingerprint = '';
  async function loadConfig() {
    if (configProvider) return await configProvider();
    try { return parseEnv(await readFile(envPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('인증 설정 파일을 읽지 못했습니다.'); }
  }
  async function request(endpoint, params, key, ttl) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.hostname !== 'apis.data.go.kr' || url.username || url.password) throw new Error('공공데이터 API 주소 설정을 확인해 주세요.');
    let decoded = key;
    try { decoded = decodeURIComponent(key); } catch {}
    url.search = new URLSearchParams({ serviceKey: decoded, ...params });
    const cacheId = url.href;
    const entry = cache.get(cacheId);
    if (entry && entry.expires > +now()) return entry.promise;
    const promise = (async () => {
      let response;
      // Edge runtimes support manual redirects; reject the 3xx response below without forwarding the key.
      try { response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' }); }
      catch { throw new Error('API 연결이 실패했거나 응답 시간이 초과되었습니다.'); }
      if (!response.ok) throw new Error(`API가 HTTP ${response.status} 오류를 반환했습니다.`);
      let json;
      try { json = await response.json(); }
      catch { throw new Error('API가 JSON 대신 오류 응답을 반환했습니다. 인증키와 활용신청을 확인해 주세요.'); }
      return unpack(json);
    })();
    cache.set(cacheId, { promise, expires: +now() + ttl });
    try { return await promise; } catch (error) { cache.delete(cacheId); throw error; }
    finally { if (cache.size > 200) for (const [id, value] of cache) if (value.expires <= +now()) cache.delete(id); }
  }
  async function loadWeather(config, key, region, time) {
    let failure;
    for (const base of forecastBases(time)) {
      try {
        const { items, totalCount } = await request(`${config.VILAGE_FCST_ENDPOINT || ENDPOINTS.weather}/getVilageFcst`, {
          pageNo: 1, numOfRows: 2000, dataType: 'JSON', base_date: base.date, base_time: base.time, nx: region.nx, ny: region.ny,
        }, key, 30 * 60000);
        if (totalCount > items.length) throw new Error('예보 응답이 잘려 전체 기간을 확인할 수 없습니다.');
        return { days: normalizeForecast(items, kstText(time).slice(0, 10)), reference: referenceText(base.date, base.time), location: region.weatherPoint };
      } catch (error) { failure = error; }
    }
    throw failure;
  }
  async function loadCurrent(config, key, region, time) {
    const base = observationBase(time);
    const { items } = await request(`${config.VILAGE_FCST_ENDPOINT || ENDPOINTS.weather}/getUltraSrtNcst`, {
      pageNo: 1, numOfRows: 20, dataType: 'JSON', base_date: base.date, base_time: base.time, nx: region.nx, ny: region.ny,
    }, key, 15 * 60000);
    const values = Object.fromEntries(items.map(i => [i.category, i.obsrValue]));
    const temp = number(values.T1H, -60, 60), humidity = number(values.REH, 0, 100);
    if (temp === null || humidity === null) throw new Error('기온 또는 습도 관측값이 없습니다.');
    return { temp, humidity, wind: number(values.WSD, 0, 100), reference: referenceText(base.date, base.time), location: region.weatherPoint };
  }
  async function loadAir(config, key, region, time) {
    const { items } = await request(`${config.AIR_POLLUTION_ENDPOINT || ENDPOINTS.air}/getCtprvnRltmMesureDnsty`, {
      pageNo: 1, numOfRows: 100, returnType: 'json', sidoName: '서울', ver: '1.3',
    }, key, 15 * 60000);
    return normalizeAir(items, region, time);
  }
  async function loadRestaurants(config, key, region, kind) {
    const endpoint = kind === 'cafe' ? config.REST_CAFE_ENDPOINT || ENDPOINTS.cafe : config.GENERAL_RESTAURANT_ENDPOINT || ENDPOINTS.restaurant;
    const { items, totalCount } = await request(`${endpoint}/info`, {
      pageNo: 1, numOfRows: 30, returnType: 'json', 'cond[ROAD_NM_ADDR::LIKE]': region.address, 'cond[SALS_STTS_CD::EQ]': '01',
    }, key, 3 * 3600000);
    const rows = normalizeRestaurants(items, region, kind);
    if (totalCount > 0 && !rows.length) throw new Error('해당 지역의 정상 영업 업소 응답을 확인하지 못했습니다.');
    return { rows, reference: rows.map(r => r.updatedAt).filter(Boolean).sort().at(-1) || '제공되지 않음', location: `${region.name} · 조회된 정상 영업 업소 중 최대 6곳` };
  }
  return async function dashboard(regionCode) {
    if (!Object.hasOwn(REGIONS, regionCode)) throw new Error('지원하지 않는 지역입니다.');
    const region = REGIONS[regionCode], time = now(), baseSample = structuredClone(samples[regionCode]);
    let config = {}, configError;
    try { config = await loadConfig(); } catch (error) { configError = error.message; }
    const key = (config.API_KEY || config.DATA_GO_KR_API_KEY || '').trim();
    const fingerprint = createHash('sha256').update(key).digest('hex');
    if (fingerprint !== keyFingerprint) { cache.clear(); keyFingerprint = fingerprint; }
    const loaders = { weather: loadWeather, current: loadCurrent, air: loadAir,
      restaurant: (c, k, r) => loadRestaurants(c, k, r, 'restaurant'), cafe: (c, k, r) => loadRestaurants(c, k, r, 'cafe') };
    const results = Object.fromEntries(await Promise.all(Object.entries(loaders).map(async ([id, loader]) => {
      try {
        if (!key) throw new Error(configError || '인증키가 없습니다. .env의 API_KEY 또는 DATA_GO_KR_API_KEY를 확인해 주세요.');
        return [id, { data: await loader(config, key, region, time) }];
      } catch (error) { return [id, { error: error.message }]; }
    })));
    const sources = Object.fromEntries(Object.entries(results).map(([id, result]) => [id, {
      name: SOURCES[id], mode: result.error ? 'sample' : 'live', reason: result.error || '',
      reference: result.data?.reference || baseSample.lastUpdated, location: result.data?.location || region.name,
    }]));
    const weather = results.weather.data, air = results.air.data, current = results.current.data;
    const samplePm10 = Number(baseSample.pmStatus.match(/\((\d+)/)?.[1] || 20);
    const effectiveAir = air || { pm10: samplePm10, pm25: 12 };
    let hourly, weekly;
    if (weather) {
      hourly = weather.days[0].hours.map(hour => {
        const score = scoreFor(hour.temp, hour.rain, effectiveAir.pm10, effectiveAir.pm25, hour.precipitation);
        return { time: hour.time, score, label: `${hour.sky} · ${scoreLabel(score)}`, temp: `${hour.temp}°C`, rain: `${hour.rain}%`, sample: !air };
      });
      // 미래의 미세먼지를 관측값으로 대신 예측하지 않습니다. 주간 비교는 날씨 점수입니다.
      weekly = weather.days.map(day => ({ date: day.date, label: dayLabel(day.date),
        score: day.available ? Math.round(average(day.hours.map(h => weatherPoints(h.temp, h.rain, h.precipitation))) / 80 * 100) : null,
        temp: day.available ? `${round(average(day.hours.map(h => h.temp)))}°C` : null,
        rain: day.available ? `${Math.max(...day.hours.map(h => h.rain))}%` : null, sample: false,
      }));
    } else {
      hourly = HOURS.map(hour => ({ ...(baseSample.hourly.find(h => h.time === `${hour}:00`) || baseSample.hourly[0]), time: `${hour}:00`, sample: true }));
      weekly = [82, 94, 75, 60, 70].map((score, index) => {
        const date = addDays(baseSample.lastUpdated.slice(0, 10), index);
        return { date, label: dayLabel(date), score, temp: '22°C', rain: '0%', sample: true };
      });
    }
    const best = weekly.filter(day => day.score !== null).sort((a, b) => b.score - a.score)[0];
    const score = Math.round(average(hourly.map(h => h.score)));
    const sampleIds = Object.keys(sources).filter(id => sources[id].mode === 'sample');
    const scoreSample = !weather || !air;
    const failureGroups = new Map();
    for (const id of sampleIds) {
      const reason = sources[id].reason;
      failureGroups.set(reason, [...(failureGroups.get(reason) || []), SOURCES[id]]);
    }
    const restaurants = ['restaurant', 'cafe'].flatMap(kind => results[kind].data?.rows || baseSample.restaurants
      .filter(row => row.type === (kind === 'cafe' ? '휴게음식점' : '일반음식점'))
      .map(row => ({ ...row, source: kind, category: kind === 'cafe' ? 'cafe' : 'restaurant', location: null, sample: true, status: '샘플 데이터', feature: '예시 업소입니다', licensedStatus: '예시 업소입니다' })));
    return {
      regionCode, regionName: region.name, lastUpdated: kstText(time),
      mode: !sampleIds.length ? 'live' : sampleIds.length === 5 ? 'sample' : 'mixed',
      score, badge: scoreLabel(score), scoreSample,
      desc: `${scoreSample ? '샘플 데이터가 포함된 ' : ''}16~22시 평균 참고 지수입니다. ${weather ? `강수확률은 최대 ${Math.max(...weather.days[0].hours.map(h => h.rain))}%입니다. ` : ''}${weather && air ? '최신 대기 관측값을 시간대별로 동일하게 반영했습니다.' : '샘플이 포함되어 실제 야외 활동 판단에는 사용할 수 없습니다.'}`,
      currentTemp: current ? `${current.temp}°C` : baseSample.currentTemp,
      humidity: current ? `${current.humidity}%` : baseSample.humidity,
      wind: current?.wind === null || !current ? null : `${current.wind}m/s`,
      rain: weather ? `${Math.max(...weather.days[0].hours.map(h => h.rain))}%` : '0%',
      goldenTime: goldenTime(hourly),
      pmStatus: air ? `${['좋음', '보통', '나쁨', '매우 나쁨'][Math.max(grade(air.pm10), grade(air.pm25, true))]} · PM10 ${air.pm10} / PM2.5 ${air.pm25}㎍/㎥` : `샘플 · PM10 ${samplePm10} / PM2.5 12㎍/㎥`,
      hourly, hourlyDate: weather ? kstText(time).slice(0, 10) : baseSample.lastUpdated.slice(0, 10), weekly,
      bestDay: { day: best?.label || '예보가 없습니다', desc: best ? `저녁 평균 ${best.temp} / 최대 강수확률 ${best.rain} / ${best.sample ? '샘플 데이터' : '기온·강수 기준'}` : '제공된 예보를 확인해 주세요.' },
      restaurants, sources, warnings: [...failureGroups].map(([reason, names]) => `${names.join('·')}: ${reason}`),
      regionNote: `${region.weatherPoint} · ${air?.location || '대기 샘플 데이터'}${regionCode === 'seoul_all' ? ' (날씨는 서울 전체 평균이 아닌 대표지점 기준입니다.)' : ''}`,
    };
  };
}
