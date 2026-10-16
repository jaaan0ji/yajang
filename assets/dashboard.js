'use strict';
const $ = id => document.getElementById(id);
const setText = (id, value) => { $(id).textContent = value ?? ''; };
const SOURCE_NAMES = { weather: '기상청 단기예보', current: '기상청 초단기실황', air: '에어코리아 대기오염정보', restaurant: '행정안전부 일반음식점', cafe: '행정안전부 휴게음식점' };
let currentData, activeCategory = 'all', renderSequence = 0, map, markerLayer;
let mapTilesFailed = false;
const markers = new Map();

function browserSample(regionCode, reason) {
  const data = structuredClone(MOCK_DATABASE[regionCode]);
  data.sources = Object.fromEntries(Object.entries(SOURCE_NAMES).map(([id, name]) => [id, { name, mode: 'sample', reference: data.lastUpdated, reason }]));
  data.regionCode = regionCode;
  data.mode = 'sample';
  data.scoreSample = true;
  data.regionNote = `${data.regionName} · 샘플 데이터입니다.`;
  data.hourlyDate = data.lastUpdated.slice(0, 10);
  data.warnings = [reason];
  data.hourly = [16,17,18,19,20,21,22].map(hour => ({ ...(data.hourly.find(h => h.time === `${hour}:00`) || data.hourly[0]), time: `${hour}:00`, sample: true }));
  data.score = Math.round(data.hourly.reduce((s,h) => s + h.score,0) / 7);
  data.wind = null;
  data.rain = '0%';
  data.goldenTime = null;
  data.desc = '16~22시 샘플 참고 지수입니다. 실제 야외 활동 판단에는 사용할 수 없습니다.';
  data.weekly = [82,94,75,60,70].map((score,index) => {
    const date = new Date(`${data.hourlyDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0,10), label: `${date.getUTCMonth()+1}/${date.getUTCDate()} (${'일월화수목금토'[date.getUTCDay()]})`, score, sample: true };
  });
  data.bestDay = { day: data.weekly[1].label, desc: '샘플 데이터입니다.' };
  data.restaurants = data.restaurants.map(row => ({ ...row, category: row.type === '휴게음식점' ? 'cafe' : 'restaurant', location: null, sample: true, status: '샘플 데이터' }));
  data.lastUpdated = '샘플 기준 2026-10-16 17:00';
  return data;
}
function sourceText(source) {
  return `${source.name}: ${source.mode === 'sample' ? '샘플 데이터' : '실제 데이터'} · 기준 ${source.reference}`;
}
function locationValid(row) {
  return !row.sample && row.location && Number.isFinite(row.location.lat) && Number.isFinite(row.location.lng)
    && row.location.lat >= 37.4 && row.location.lat <= 37.75 && row.location.lng >= 126.7 && row.location.lng <= 127.25;
}
function mapLink(row) { return `https://map.naver.com/p/search/${encodeURIComponent(row.address + ' ' + row.name)}`; }
function filteredRestaurants() {
  return currentData.restaurants.filter(row => activeCategory === 'all' || row.category === activeCategory);
}
function fitMapToRows(rows) {
  const points = rows.filter(locationValid).map(row=>[row.location.lat,row.location.lng]);
  if (map && points.length) map.fitBounds(points, { padding:[35,35], maxZoom:15, animate:false });
}
function makeMap() {
  if (map || !window.L) return;
  map = L.map('spot-map', { scrollWheelZoom: false }).setView([37.56,126.98],12);
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);
  tiles.on('tileerror', () => { mapTilesFailed = true; setText('map-message','지도 배경을 불러오지 못했습니다. 목록에서 업소를 선택한 뒤 네이버 지도로 확인해 주세요.'); });
  tiles.on('tileload', () => { if (mapTilesFailed) { mapTilesFailed = false; updateMapMessage(); } });
  markerLayer = L.layerGroup().addTo(map);
  new ResizeObserver(() => { map.invalidateSize(); if (currentData) fitMapToRows(filteredRestaurants()); }).observe($('spot-map'));
}
function updateMapMessage() {
  if (!currentData || mapTilesFailed) return;
  const rows = filteredRestaurants(), placed = rows.filter(locationValid).length;
  const missing = rows.filter(row=>!row.sample && !locationValid(row)).length;
  setText('map-message', !window.L ? '지도를 불러오지 못했습니다. 아래 목록에서 주소를 검색해 주세요.' :
    `조회된 ${rows.length}곳 중 좌표가 확인된 ${placed}곳을 표시합니다.${missing ? ' 좌표가 없는 업소는 주소 검색으로 확인해 주세요.' : ''}`);
}
function renderMap(rows) {
  makeMap();
  const located = rows.filter(locationValid);
  setText('map-count', `${located.length}곳`);
  $('map-empty').hidden = !!(located.length && map);
  if (!rows.length) setText('map-empty','이 지역의 조회된 업소 중 해당 업종이 없습니다. 다른 필터를 선택해 주세요.');
  else if (rows.every(row => row.sample)) setText('map-empty','샘플 데이터입니다. 예시 업소의 위치는 지도에 표시하지 않습니다.');
  else setText('map-empty', map ? '좌표가 제공되지 않았습니다. 업소 목록에서 주소를 검색해 주세요.' : '지도 연결을 확인해 주세요. 업소 목록은 계속 이용하실 수 있습니다.');
  updateMapMessage();
  if (!map) return;
  markerLayer.clearLayers(); markers.clear();
  rows.forEach((row,index) => {
    if (!locationValid(row)) return;
    const point = [row.location.lat,row.location.lng];
    const icon = L.divIcon({ className:'place-pin', html:`<div class="spot-marker"><span>${index+1}</span></div>`, iconSize:[32,32], iconAnchor:[16,32] });
    const marker = L.marker(point, { icon, title:row.name, alt:row.name, keyboard:true }).addTo(markerLayer);
    const popup = document.createElement('div'); popup.className = 'map-popup';
    const name = document.createElement('strong'); name.textContent = row.name;
    const address = document.createElement('p'); address.textContent = row.address;
    const status = document.createElement('p'); status.textContent = '영업/정상 · 인허가 정보 기준';
    const link = document.createElement('a'); link.href = mapLink(row); link.textContent = '네이버 지도에서 확인'; link.target='_blank'; link.rel='noopener noreferrer';
    popup.append(name,address,status,link); marker.bindPopup(popup);
    markers.set(row,marker);
  });
  fitMapToRows(rows);
}
function renderRestaurants() {
  const rows = filteredRestaurants();
  const body = $('restaurant-table-body'); body.replaceChildren();
  rows.forEach((row,index) => {
    const tr = document.createElement('tr');
    const entries = [
      ['place-name',`${index+1}. ${row.name}`], ['place-type',row.type], ['place-address',row.address],
      [`place-status${row.sample ? ' sample' : ''}`,row.sample ? '샘플 데이터' : '영업/정상']
    ];
    entries.forEach(([className,text]) => { const cell = document.createElement('td'); cell.className=className; cell.textContent=text; tr.appendChild(cell); });
    const action = document.createElement('td'); action.className='place-action';
    if (locationValid(row) && window.L) {
      const button = document.createElement('button'); button.type='button'; button.textContent='지도에서 보기'; button.setAttribute('aria-label',`${row.name} 지도에서 보기`);
      button.addEventListener('click',() => { $('spots').scrollIntoView({behavior:'auto'}); const marker=markers.get(row); if (marker) { map.setView(marker.getLatLng(),16,{animate:false}); marker.openPopup(); } });
      action.appendChild(button);
    } else if (!row.sample) {
      const link = document.createElement('a'); link.textContent='주소 검색'; link.href=mapLink(row); link.target='_blank'; link.rel='noopener noreferrer'; action.appendChild(link);
    }
    tr.appendChild(action); body.appendChild(tr);
  });
  if (!rows.length) { const cell=body.insertRow().insertCell(); cell.colSpan=5; cell.className='empty-cell'; cell.textContent='조회된 업소 중 해당 업종이 없습니다. 다른 필터를 선택해 주세요.'; }
  const sourceSample = [currentData.sources.restaurant,currentData.sources.cafe].some(s=>s.mode==='sample');
  setText('restaurant-mode',sourceSample ? '샘플 데이터 포함' : '인허가상 영업/정상');
  const sampleCount = rows.filter(row=>row.sample).length;
  const liveCount = rows.length - sampleCount;
  setText('recommendation-summary', sampleCount === rows.length && sampleCount ? '예시 업소 목록입니다.' :
    sampleCount ? `정상 영업 업소 ${liveCount}곳과 샘플 ${sampleCount}곳을 표시합니다.` : `조회된 정상 영업 업소 ${liveCount}곳을 확인해 보세요.`);
  setText('restaurant-source','인허가 정보 기준입니다. 실시간 개점 여부와는 다를 수 있습니다.');
  renderMap(rows);
}
function renderChart(data) {
  const chart = $('hourly-chart'); chart.replaceChildren();
  const golden = data.goldenTime?.recommended ? data.goldenTime.hours : [];
  data.hourly.forEach(hour => {
    const button = document.createElement('button'); button.type='button'; button.className=`hour-button${golden.includes(hour.time) ? ' golden' : ''}`;
    button.setAttribute('aria-label',`${hour.time} ${hour.score}점, 기온 ${hour.temp}, 강수확률 ${hour.rain}`);
    button.setAttribute('aria-pressed','false');
    const track=document.createElement('span'); track.className='bar-track';
    const value=document.createElement('span'); value.className='hour-value'; value.textContent=hour.score;
    const bar=document.createElement('span'); bar.className='hour-bar'; bar.style.height=`${Math.max(3,Math.min(100,hour.score))}%`;
    track.append(value,bar);
    const label=document.createElement('span'); label.className='hour-label'; label.textContent=Number(hour.time.slice(0,2))+'시';
    button.append(track,label);
    button.addEventListener('click',() => {
      chart.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      setText('hour-detail',`${hour.time} · ${hour.score}점 · ${hour.temp} · 강수 ${hour.rain}${data.scoreSample ? ' · 샘플 데이터' : ''}`);
    });
    chart.appendChild(button);
  });
  setText('hourly-date',data.hourlyDate.slice(5).replace('-','/'));
  setText('hour-detail',data.scoreSample ? '샘플 데이터입니다. 막대를 선택하시면 예시를 확인할 수 있어요.' : data.goldenTime?.recommended ? `${data.goldenTime.label}가 가장 좋은 시간대예요. 막대를 눌러 날씨를 확인해 보세요.` : '야외 활동에 좋은 시간대가 없습니다. 막대를 눌러 날씨를 확인해 주세요.');
}
function paintDashboard(data) {
  currentData=data;
  const sources=data.sources;
  setText('data-mode',data.mode==='live' ? '실제 데이터' : data.mode==='mixed' ? '샘플 데이터 포함' : '샘플 데이터');
  $('data-mode').className=`data-badge${data.mode==='live' ? '' : ' sample'}`;
  setText('last-updated',data.lastUpdated.includes('샘플') ? data.lastUpdated : `${data.lastUpdated} KST 기준 조회`);
  setText('score-val',data.score);
  $('score-ring').style.setProperty('--score',Math.max(0,Math.min(100,data.score)));
  const rating=data.score>=80 ? '아주 좋음' : data.score>=60 ? '보통' : '주의가 필요해요';
  setText('score-badge',rating);
  setText('hero-title',data.score>=80 ? '오늘은\n야장하기 좋은 날!' : data.score>=60 ? '오늘은\n날씨를 살펴보세요.' : '오늘은\n실내를 추천드려요.');
  const golden=data.goldenTime;
  setText('golden-summary',data.scoreSample ? '샘플 데이터 · 실제 예보를 확인해 주세요' : golden?.recommended ? `${rating} · ${golden.label} 골든타임` : '쾌적한 야외 시간대를 찾지 못했어요');
  setText('score-source',data.scoreSample ? '16–22시 평균 · 샘플 데이터 포함' : '16–22시 평균 · 기온, 강수, 대기를 반영했어요');
  setText('current-temp',data.currentTemp);
  setText('current-wind',data.wind || '—');
  setText('current-rain',data.rain || '—');
  setText('current-humidity',data.humidity);
  ['temp-mode','humidity-mode'].forEach(id=>setText(id,sources.current.mode==='sample' ? '샘플 데이터' : '현재 관측'));
  setText('wind-mode',data.wind ? '현재 관측' : '제공된 값이 없어요');
  setText('rain-mode',sources.weather.mode==='sample' ? '샘플 데이터' : '16–22시 최대');
  renderChart(data);
  const weekly=$('weekly-days'); weekly.replaceChildren();
  const best=[...data.weekly].filter(d=>Number.isFinite(d.score)).sort((a,b)=>b.score-a.score)[0];
  data.weekly.forEach(day=>{
    const cell=document.createElement('div'); cell.className=`day-cell${day.date===best?.date ? ' best' : ''}${day.score===null ? ' unavailable' : ''}`;
    const label=document.createElement('span'); label.textContent=day.label;
    const value=document.createElement(day.score===null ? 'small':'strong'); value.textContent=day.score===null ? '예보 없음' : `${day.score}점`;
    cell.append(label,value); weekly.appendChild(cell);
  });
  setText('best-day-title',best ? `${best.label} 추천` : '예보를 기다리고 있어요');
  setText('best-day-desc',data.bestDay.desc);
  setText('weekly-source',`${sources.weather.mode==='sample' ? '샘플 데이터 · ' : ''}제공된 예보 기간의 기온·강수 기준입니다.`);
  setText('current-air',`${data.pmStatus}${sources.air.mode==='sample' ? ' · 샘플 데이터' : ''}`);
  setText('source-warning',data.warnings.length ? '샘플 사용 내역이 있어요' : '');
  setText('source-status',data.warnings.length ? data.warnings.join(' / ') : '모든 데이터가 정상 연결되었습니다.');
  setText('region-note',data.regionNote);
  setText('score-desc',data.desc);
  $('source-list').replaceChildren();
  Object.values(sources).forEach(source=>{ const p=document.createElement('p'); p.textContent=sourceText(source); $('source-list').appendChild(p); });
  renderRestaurants();
}
async function renderDashboard(regionCode) {
  const sequence=++renderSequence;
  if (!currentData || currentData.regionCode!==regionCode) paintDashboard(browserSample(regionCode,'실제 데이터를 불러오고 있습니다.'));
  $('data-mode').className='data-badge loading'; setText('data-mode',currentData?.mode==='sample' ? '불러오는 중 · 샘플 데이터' : '새로고침 중');
  $('refresh-button').disabled=true; $('dashboard').setAttribute('aria-busy','true');
  let data;
  try { data=await DataService.fetchDashboardData(regionCode); }
  catch { data=browserSample(regionCode,'서버 연결에 실패했습니다. 잠시 후 새로고침해 주세요.'); }
  if (sequence!==renderSequence) return;
  try { paintDashboard(data); }
  catch { paintDashboard(browserSample(regionCode,'데이터를 표시하지 못했습니다. 샘플을 보여 드립니다.')); }
  finally { $('refresh-button').disabled=false; $('dashboard').setAttribute('aria-busy','false'); }
}
$('region-select').addEventListener('change',event=>renderDashboard(event.target.value));
$('refresh-button').addEventListener('click',()=>renderDashboard($('region-select').value));
document.querySelectorAll('[data-category]').forEach(button=>button.addEventListener('click',()=>{
  activeCategory=button.dataset.category;
  document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  renderRestaurants();
}));
document.querySelectorAll('.desktop-nav a,.mobile-nav a').forEach(link=>link.addEventListener('click',()=>{
  document.querySelectorAll('.desktop-nav a,.mobile-nav a').forEach(a=>a.classList.toggle('active',a.hash===link.hash));
}));
const month=Number(new Intl.DateTimeFormat('en',{month:'numeric',timeZone:'Asia/Seoul'}).format(new Date()));
setText('season-label',`${month>=3&&month<=5?'SPRING':month>=6&&month<=8?'SUMMER':month>=9&&month<=11?'AUTUMN':'WINTER'} OUTDOOR GUIDE`);
renderDashboard($('region-select').value);
setInterval(()=>renderDashboard($('region-select').value),30*60*1000);
