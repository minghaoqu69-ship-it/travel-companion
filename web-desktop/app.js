/* =========================================================================
 * 随行导览 · 电脑网页版（周边景点 / 酒店 / 攻略）
 * 基于 高德地图 JS API 2.0 —— 桌面布局：左侧栏 + 右侧地图
 * 复用国内版 v1.5 的核心能力：自定义标记、详细攻略、周边店鋪/活动
 * ========================================================================= */

/* ====== 配置区（发布前请修改） ====== */
const CONFIG = {
  // 高德 Web端(JS API) Key。控制台需将「域名白名单」设为 *（含 localhost / 任意网页）
  AMAP_KEY: 'YOUR_AMAP_JS_KEY',
  // 安全密钥（2021-12 之后申请的新 Key 需要）
  SECURITY_CODE: 'YOUR_AMAP_SECURITY_CODE',
  // 高德 Web服务 Key（可选，强烈建议填）：用于拉取更全的 POI 详情（图片/简介/人均/周边）
  WEB_KEY: 'YOUR_AMAP_WEB_KEY',
  // Google Maps JS API Key（可选）：用于「高德缺数据时的兜底」，补充评分/用户评价/图片。
  // 需在 Google Cloud 启用 Maps JavaScript API + Places API；将「网站限制」设为允许本域名与 localhost。
  // 注意：Google 在大陆直连被墙，需境外或挂 VPN 才能用；国内使用时此兜底会自动失效、不影响高德主功能。
  GOOGLE_KEY: '',
  // 携程联盟（Ctrip Affiliate）推广参数：注册 affiliate.ctrip.com 后，在「账户 > 管理我的网站」获取
  // 填后，「去携程看真实价格」按钮将带上你的联盟追踪，用户通过此链接下单你赚佣金（CPS 分成）。
  // 留空则不带追踪（仅普通深链）。联盟 Cookie 有效期 30 天，佣金率约国内酒店 5–15%、门票/度假约 10%。
  CTRIP_AID: '',   // 联盟 ID (Alliance ID)
  CTRIP_SID: '',   // 网站 ID (Site ID)
  SEARCH_RADIUS: 3000,     // 周边搜索半径（米）
  MAX_RESULTS: 25,
};

/* 定位失败时的默认中心（温州·乐清），保证网页一打开就有地图可测 */
const DEFAULT_CENTER = [120.960, 28.130];
const DEFAULT_CITY = '乐清';

/* 分类配置：keyword 用于高德周边搜索 */
const CATEGORIES = {
  scene: { label: '附近景点', keyword: '旅游景点', icon: '🏞️' },
  food:  { label: '附近美食', keyword: '美食',     icon: '🍜' },
  shop:  { label: '附近商场', keyword: '商场',     icon: '🛍️' },
  hotel: { label: '附近酒店', keyword: '酒店',     icon: '🏨' },
  guide: { label: '游玩攻略', keyword: null,       icon: '📖' },
};

/* 详情弹窗里「周边好店 / 美食」「近期活动」的搜索关键词 */
const SHOP_KEYWORDS = '美食|餐厅|小吃|咖啡|蛋糕|购物|商场|店铺|超市';
const EVENT_KEYWORDS = '活动|展览|演出|市集|展会|剧场|音乐节|庙会';

/* ====== 全局状态 ====== */
let map = null;
let placeSearch = null;
let detailSearch = null;
let satellite = null;
let roadNet = null;
let isSatellite = false;
let currentType = 'scene';
let currentCenter = null;
let lastSearchCenter = null;
let markers = [];
let sceneCache = [];
let lastPois = [];          // 最近一次搜索的原始结果（用于免费/收费筛选，免重复请求）
let sceneFilter = 'all';    // 景点筛选：all | free | paid

/* 我的行程 / 路线规划 */
let tripList = [];          // [{name, lng, lat, address, type}]
let tripMarkers = [];       // 行程编号标记
let tripPolylines = [];     // 路线折线
let tripMode = 'driving';   // driving | walking | transit

/* ====== 工具函数 ====== */
function distMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

function fmtDist(m) {
  if (m == null) return '';
  return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m';
}

/* 价格 / 收费信息
 * 高德返回 cost（部分在 biz_ext.cost）：景点 = 门票参考价，酒店 = 人均消费参考
 * 注意：免费接口不提供实时房价/票价，以下为参考值，可能为「未收录」 */
function pickCost(poi) {
  let c = poi && poi.cost;
  if (c == null && poi && poi.biz_ext) c = poi.biz_ext.cost;
  if (c == null || c === '') return null;
  if (/免费|免票|免费开放/i.test(String(c))) return 0;
  const m = String(c).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/* 返回 {txt, cls}，cls: free | paid | price | unknown */
function priceBadge(type, poi) {
  const c = pickCost(poi);
  if (type === 'scene') {
    if (c === 0) return { txt: '免费', cls: 'free' };
    if (c && c > 0) return { txt: '收费 ¥' + c, cls: 'paid' };
    return { txt: '免费/未标明', cls: 'unknown' };
  }
  if (type === 'hotel') {
    if (c && c > 0) return { txt: '人均约 ¥' + c, cls: 'price' };
    return { txt: '价格未收录', cls: 'unknown' };
  }
  return null;
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function escapeHtml(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* 自定义标记（纯 CSS + emoji，避免裂图） */
function makeMarker(pos, emoji, color) {
  return new AMap.Marker({
    position: pos,
    anchor: 'bottom-center',
    zIndex: 100,
    content: `<div class="mk" style="--c:${color || '#ff6b35'}"><span>${emoji}</span></div>`,
  });
}

/* 在地图内导航：从「我的位置」到目的地画出路线（不跳出） */
let navPolyline = null;
let navStartMarker = null;
function navigateTo(lng, lat, name) {
  const to = { lng: lng, lat: lat };
  const from = (currentCenter && currentCenter.length === 2)
    ? { lng: currentCenter[0], lat: currentCenter[1] } : null;
  if (!from) { toast('正在定位，请稍候再试'); return; }
  if (!map) { toast('地图尚未就绪'); return; }
  toast('正在规划到「' + (name || '目的地') + '」的路线…');
  if (navPolyline) { navPolyline.setMap(null); navPolyline = null; }
  if (navStartMarker) { navStartMarker.setMap(null); navStartMarker = null; }
  planSegment(from, to, tripMode, (res) => {
    navPolyline = new AMap.Polyline({
      path: res.path, strokeColor: '#2b6cff', strokeWeight: 6, strokeOpacity: 0.9,
      lineJoin: 'round', showDir: true, zIndex: 180,
    });
    navPolyline.setMap(map);
    navStartMarker = new AMap.Marker({
      position: [from.lng, from.lat],
      content: '<div style="background:#2b6cff;color:#fff;width:26px;height:26px;border-radius:50%;' +
        'display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fff;' +
        'box-shadow:0 2px 6px rgba(0,0,0,.35)">我</div>',
      anchor: 'center', zIndex: 300,
    });
    navStartMarker.setMap(map);
    map.setFitView([navStartMarker], false, [80, 80, 180, 80]);
    const km = (res.dist / 1000).toFixed(1);
    const min = Math.round(res.dur / 60);
    const t = min >= 60 ? (Math.floor(min / 60) + ' 时 ' + (min % 60) + ' 分') : (min + ' 分钟');
    toast('路线已生成：' + km + ' km · 约 ' + t);
    if (typeof renderCurrentDetail === 'function') renderCurrentDetail();
  });
}
function clearNavRoute() {
  if (navPolyline) { navPolyline.setMap(null); navPolyline = null; }
  if (navStartMarker) { navStartMarker.setMap(null); navStartMarker = null; }
  toast('已清除路线');
  if (typeof renderCurrentDetail === 'function') renderCurrentDetail();
}
/* 在高德网页打开（跳出，用户主动选择才调用） */
function navigateExternal(lng, lat, name) {
  const n = encodeURIComponent(name || '目的地');
  const url = `https://uri.amap.com/navigation?to=${lng},${lat},${n}` +
    `&mode=car&policy=1&src=suixing&coordinate=gaode&callnative=1`;
  window.open(url, '_blank');
}
window.__navigateTo = navigateTo;
window.__clearNavRoute = clearNavRoute;
window.__navigateExternal = navigateExternal;

/* 跳转到携程查看真实价格 / 预订（深链，免费、合规、国内可用；
 * 携程无免费数据 API，故采用深链方式让用户看到真实房价/门票） */
function ctripSearchUrl(type, name) {
  const n = encodeURIComponent(name || '');
  let base;
  if (type === 'hotel') base = 'https://hotels.ctrip.com/hotels/list?keyword=' + n;
  // 携程景点门票为纯前端 JS 搜索，无可用关键词深链，落地官方门票首页供用户即时搜索
  else base = 'https://huodong.ctrip.com/things-to-do/web-home';
  // 拼接携程联盟追踪参数（AID/SID），让用户下单可追溯佣金；留空则不附加
  const aid = (CONFIG.CTRIP_AID || '').trim();
  const sid = (CONFIG.CTRIP_SID || '').trim();
  if (aid) {
    base += (base.indexOf('?') >= 0 ? '&' : '?') + 'Allianceid=' + encodeURIComponent(aid);
    if (sid) base += '&sid=' + encodeURIComponent(sid);
  }
  return base;
}

/* 聚焦某个点 */
function focusPoint(lng, lat) {
  if (map) map.setZoomAndCenter(16, [lng, lat]);
}
window.__focusPoint = focusPoint;

/* ====== 初始化地图 ====== */
function initMap(center) {
    map = new AMap.Map('map', {
    zoom: 14,
    center: center,
    resizeEnable: true,
  });

  placeSearch = new AMap.PlaceSearch({ pageSize: CONFIG.MAX_RESULTS, pageIndex: 1, citylimit: false });
  detailSearch = new AMap.PlaceSearch({ pageSize: 10, pageIndex: 1, citylimit: false });

  satellite = new AMap.TileLayer.Satellite();
  roadNet = new AMap.TileLayer.RoadNet();

  const me = new AMap.Marker({
    position: center,
    content: '<div style="font-size:30px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))">📍</div>',
    anchor: 'center',
    zIndex: 200,
  });
  me.setMap(map);
  window.__meMarker = me;
}

function updateMeMarker(center) {
  if (window.__meMarker) window.__meMarker.setPosition(center);
}

/* ====== 周边搜索 ====== */
function clearMarkers() {
  markers.forEach((m) => m.setMap(null));
  markers = [];
}

function searchNearby(type) {
  const cat = CATEGORIES[type];
  if (!cat || !cat.keyword || !currentCenter) return;
  toast('正在搜索' + cat.label + '…');
  placeSearch.setType('');
  placeSearch.searchNearBy(cat.keyword, currentCenter, CONFIG.SEARCH_RADIUS, (status, result) => {
    if (status === 'complete' && result.poiList) {
      const pois = result.poiList.pois || [];
      renderResults(type, pois);
      lastSearchCenter = currentCenter.slice();
    } else if (status === 'no_data') {
      renderResults(type, []);
      toast('附近没有找到相关结果');
    } else {
      toast('搜索失败，请稍后重试');
      console.error('placeSearch error:', status, result);
    }
  });
}

/* ====== 渲染列表 + 标记 ====== */
function renderResults(type, pois) {
  clearMarkers();
  const cat = CATEGORIES[type];
  const body = document.getElementById('list');
  const countEl = document.getElementById('listCount');
  body.innerHTML = '';

  // 保存原始结果（供免费/收费筛选，免重复请求）
  lastPois = pois.slice();
  if (type === 'scene') sceneCache = pois.slice();

  // 景点：按免费/收费筛选
  let disp = pois;
  if (type === 'scene' && sceneFilter !== 'all') {
    disp = pois.filter((p) => {
      const b = priceBadge('scene', p);
      if (sceneFilter === 'free') return b.cls === 'free';
      if (sceneFilter === 'paid') return b.cls === 'paid';
      return true;
    });
  }

  if (!disp.length) {
    const msg = type === 'scene' && sceneFilter !== 'all'
      ? ('附近暂未找到「' + (sceneFilter === 'free' ? '免费' : '收费') + '」景点')
      : ('附近暂未找到' + cat.label);
    body.innerHTML = '<div class="empty">' + msg + '<br>可尝试切换分类、移动地图或搜索其他城市</div>';
    countEl.textContent = '';
    return;
  }

  countEl.textContent = disp.length + ' 个结果';
  disp.sort((a, b) => (a.distance || 0) - (b.distance || 0));

  const bounds = [];
  disp.forEach((poi, i) => {
    const loc = poi.location;
    if (!loc) return;
    const pos = [loc.lng, loc.lat];
    bounds.push(pos);

    const marker = makeMarker(pos, cat.icon, type === 'hotel' ? '#2b6cff' : '#ff6b35');
    marker.on('click', () => openDetail(poi, type));
    marker.setMap(map);
    markers.push(marker);

    const card = document.createElement('div');
    card.className = 'card';
    const rating = poi.rating ? `<span class="tag">评分 ${poi.rating}</span>` : '';
    const tel = poi.tel ? `<span class="tag">☎ ${escapeHtml(poi.tel.split(';')[0])}</span>` : '';
    const badge = priceBadge(type, poi);
    const badgeHtml = badge ? `<span class="tag ${badge.cls}">${badge.txt}</span>` : '';
    card.innerHTML = `
      <div class="thumb">${cat.icon}</div>
      <div class="info">
        <p class="name">${escapeHtml(poi.name)}</p>
        <div class="meta">
          <span class="dist">${fmtDist(poi.distance)}</span>
          ${badgeHtml}${rating}${tel}<br>
          <span>${escapeHtml(poi.address || '暂无地址')}</span>
        </div>
        <div class="actions">
          <button class="mini-btn map" data-i="${i}">看地图</button>
          <button class="mini-btn nav" data-i="${i}">导航</button>
          <button class="mini-btn add" data-i="${i}">＋行程</button>
        </div>
      </div>`;
    card.querySelector('.map').onclick = (e) => { e.stopPropagation(); focusPoint(pos[0], pos[1]); openDetail(poi, type); };
    card.querySelector('.nav').onclick = (e) => { e.stopPropagation(); navigateTo(pos[0], pos[1], poi.name); };
    card.querySelector('.add').onclick = (e) => { e.stopPropagation(); tripAdd(poi); };
    card.onclick = () => { focusPoint(pos[0], pos[1]); openDetail(poi, type); };
    body.appendChild(card);
  });

  if (bounds.length) map.setFitView(markers, false, [40, 40, 40, 40]);
}

/* ====== 攻略（由景点数据生成） ====== */
function guideText(poi) {
  const s = (poi.name || '') + (poi.type || '');
  let theme = '休闲打卡', fun = '', play = '';
  if (/古|庙|寺|观|祠|塔|遗址|博物|文化|故居|纪念|城墙|阁|陵园|墓/.test(s)) {
    theme = '历史文化';
    fun = '感受历史底蕴与古建之美，非常出片，适合慢慢逛、拍照打卡。';
    play = '建议跟着导览牌了解典故；清晨或傍晚人少、光线更好；可看简介牌或请讲解员。';
  } else if (/公园|湖|山|岛|湿地|森林|峡|谷|河|海滨|沙滩|海|草原|水库|瀑布|温泉/.test(s)) {
    theme = '自然风光';
    fun = '亲近自然、散步骑行、观景拍照，呼吸新鲜空气，最适合放松身心。';
    play = '沿主步道环线游览，带好饮水与轻便鞋；晴天视野最佳，注意防蚊防晒。';
  } else if (/街|商业|购物|市集|广场|中心|mall|城|步行/.test(s)) {
    theme = '逛街休闲';
    fun = '逛吃购物、打卡特色小店与咖啡馆，感受在地烟火气与潮流氛围。';
    play = '先逛主干道再拐进小巷探店；留意营业时间，饭点人最多，错峰更舒心。';
  } else if (/乐园|游乐园|主题|水世界|动物园|海洋|马戏|亲子|儿童|欢乐/.test(s)) {
    theme = '亲子游乐';
    fun = '项目丰富、互动性强，是带娃放电、全家出游的好去处。';
    play = '热门项目先玩，错峰用餐；留意身高与项目限制，备好防晒与替换衣物。';
  } else {
    theme = '休闲打卡';
    fun = '随手拍都好看，适合慢节奏闲逛、发朋友圈记录。';
    play = '跟着地图标记慢慢逛，留意周边的美食与停车位置。';
  }
  return { theme, fun, play };
}

function renderGuides() {
  const body = document.getElementById('list');
  const countEl = document.getElementById('listCount');
  clearMarkers();
  body.innerHTML = '';

  if (!sceneCache.length) {
    toast('正在生成周边攻略…');
    placeSearch.searchNearBy(CATEGORIES.scene.keyword, currentCenter, CONFIG.SEARCH_RADIUS, (status, result) => {
      if (status === 'complete' && result.poiList) {
        sceneCache = result.poiList.pois || [];
        buildGuideCards();
      } else {
        body.innerHTML = '<div class="empty">暂未获取到周边景点<br>请稍后或移动位置重试</div>';
      }
    });
    return;
  }
  buildGuideCards();

  function buildGuideCards() {
    const top = sceneCache.slice().sort((a, b) => (a.distance || 0) - (b.distance || 0)).slice(0, 8);
    countEl.textContent = top.length + ' 条攻略';

    const tip = document.createElement('div');
    tip.className = 'card guide-tip';
    tip.innerHTML = `
      <div class="thumb">🧭</div>
      <div class="info">
        <p class="name">周边游玩攻略</p>
        <div class="meta">
          当前位置周边 <b>${top.length}</b> 个景点。<br>
          下方按距离给出每个地点的<b>玩法</b>与<b>有什么好玩</b>；<br>
          点卡片或地图标记可看店铺、活动与一键导航。
        </div>
      </div>`;
    body.appendChild(tip);

    if (top.length >= 2) {
      const route = document.createElement('div');
      route.className = 'card route-card';
      const steps = top.slice(0, 5).map((p, i) =>
        `<li><span class="rn">${i + 1}</span> <b>${escapeHtml(p.name)}</b> <span class="nd">${fmtDist(p.distance)}</span></li>`
      ).join('');
      route.innerHTML = `
        <div class="thumb">🗺️</div>
        <div class="info">
          <p class="name">推荐半日游路线</p>
          <div class="meta">按距离由近及远串联，省时省力：</div>
          <ol class="route-ol">${steps}</ol>
        </div>`;
      body.appendChild(route);
    }

    top.forEach((poi, i) => {
      const loc = poi.location;
      if (!loc) return;
      const pos = [loc.lng, loc.lat];
      const marker = makeMarker(pos, '🏞️', '#ff6b35');
      marker.on('click', () => openDetail(poi, 'scene'));
      marker.setMap(map);
      markers.push(marker);

      const g = guideText(poi);
      const badge = priceBadge('scene', poi);
      const badgeHtml = badge ? `<span class="tag ${badge.cls}">${badge.txt}</span>` : '';
      const card = document.createElement('div');
      card.className = 'card guide-card';
      card.innerHTML = `
        <div class="thumb">🏞️</div>
        <div class="info">
          <p class="name">${escapeHtml(poi.name)}</p>
          <div class="meta">
            <span class="dist">${fmtDist(poi.distance)}</span>
            ${badgeHtml}
            <span class="tag" style="border-color:#ffd9c7;color:#e85a25">${g.theme}</span>
            <span class="tag">建议 ${1 + (i % 3)} 小时</span><br>
            <span>${escapeHtml(poi.address || '暂无地址')}</span>
          </div>
          <div class="guide-block">
            <div class="gb-t">🎯 有什么好玩</div>
            <div class="gb-c">${escapeHtml(g.fun)}</div>
            <div class="gb-t">🚶 怎么玩</div>
            <div class="gb-c">${escapeHtml(g.play)}</div>
          </div>
          <div class="actions">
            <button class="mini-btn map">看地图</button>
            <button class="mini-btn nav">导航</button>
          </div>
        </div>`;
      card.querySelector('.map').onclick = (e) => { e.stopPropagation(); focusPoint(pos[0], pos[1]); openDetail(poi, 'scene'); };
      card.querySelector('.nav').onclick = (e) => { e.stopPropagation(); navigateTo(pos[0], pos[1], poi.name); };
      card.onclick = () => { focusPoint(pos[0], pos[1]); openDetail(poi, 'scene'); };
      body.appendChild(card);
    });

    if (markers.length) map.setFitView(markers, false, [40, 40, 40, 40]);
  }
}

/* ==================== 我的行程 / 一键规划路线 ==================== */
/* 加入行程 */
function tripAdd(poi) {
  if (!poi || !poi.location) { toast('该地点缺少坐标，无法加入'); return; }
  const key = poi.name + '|' + poi.location.lng + ',' + poi.location.lat;
  if (tripList.some((x) => x.key === key)) { toast('已在行程中'); return; }
  tripList.push({
    key,
    name: poi.name,
    lng: poi.location.lng,
    lat: poi.location.lat,
    address: poi.address || '',
  });
  toast('已加入行程：' + poi.name);
  renderTrip();
}
function tripRemove(i) {
  tripList.splice(i, 1);
  renderTrip();
  if (tripList.length < 2) clearTripRoute();
}
function tripClear() {
  tripList = [];
  clearTripRoute();
  renderTrip();
  toast('已清空行程');
}
/* 清掉地图上的路线与编号标记 */
function clearTripRoute() {
  tripMarkers.forEach((m) => m.setMap(null));
  tripMarkers = [];
  tripPolylines.forEach((p) => p.setMap(null));
  tripPolylines = [];
  const sum = document.getElementById('tripSum');
  if (sum) sum.innerHTML = '';
}
/* 渲染行程面板 */
function renderTrip() {
  const panel = document.getElementById('tripPanel');
  const fab = document.getElementById('tripFab');
  const list = document.getElementById('tripList');
  const cnt = document.getElementById('tripCount');
  const fabN = document.getElementById('tripFabN');
  if (!panel) return;
  const n = tripList.length;
  if (cnt) cnt.textContent = n;
  if (fabN) fabN.textContent = n;
  if (fab) fab.hidden = n === 0;
  if (n === 0) { panel.hidden = true; return; }
  panel.hidden = false;
  // 首次出现保持收起态，不挡地图；点浮标再展开
  if (!panel.dataset.inited) {
    panel.dataset.inited = '1';
    panel.classList.add('collapsed');
    panel.style.transform = '';
  }
  if (list) {
    list.innerHTML = tripList.map((t, i) =>
      `<li><span class="trip-no">${i + 1}</span><span class="trip-nm">${escapeHtml(t.name)}</span>` +
      `<button class="trip-del" data-i="${i}" title="移除">✕</button></li>`
    ).join('');
    list.querySelectorAll('.trip-del').forEach((b) => {
      b.onclick = () => tripRemove(parseInt(b.getAttribute('data-i'), 10));
    });
  }
  const go = document.getElementById('tripGo');
  if (go) go.disabled = n < 2;
}
/* ===== 行程面板：底部抽屉展开/收起（支持下拉收起、上拉展开） ===== */
function tripPanelOpen() {
  const p = document.getElementById('tripPanel');
  if (!p) return;
  p.classList.remove('collapsed');
  p.style.transform = '';
}
function tripPanelCollapse() {
  const p = document.getElementById('tripPanel');
  if (!p) return;
  p.style.transform = '';
  p.classList.add('collapsed');
  if (map && map.resize) setTimeout(() => map.resize(), 300);
}
function tripPanelToggle() {
  const p = document.getElementById('tripPanel');
  if (!p) return;
  if (p.classList.contains('collapsed')) tripPanelOpen();
  else tripPanelCollapse();
  if (map && map.resize) setTimeout(() => map.resize(), 300);
}
/* 绑定拖拽手势：在把手/标题栏上下拖动切换展开收起 */
function bindTripDrawer() {
  const panel = document.getElementById('tripPanel');
  const grip = document.getElementById('tripGrip');
  const head = document.getElementById('tripHead');
  if (!panel) return;
  const handles = [grip, head].filter(Boolean);
  handles.forEach((h) => {
    let startY = 0, moved = false, dragging = false, startCollapsed = false;
    const onDown = (e) => {
      dragging = true; moved = false;
      startY = (e.touches ? e.touches[0].clientY : e.clientY);
      startCollapsed = panel.classList.contains('collapsed');
      panel.style.transition = 'none';
    };
    const onMove = (e) => {
      if (!dragging) return;
      const y = (e.touches ? e.touches[0].clientY : e.clientY);
      const dy = y - startY;
      if (Math.abs(dy) > 4) moved = true;
      const base = startCollapsed ? (panel.offsetHeight - 40) : 0;
      let t = base + dy;
      t = Math.max(0, Math.min(panel.offsetHeight - 40, t));
      panel.style.transform = 'translateY(' + t + 'px)';
      if (e.cancelable) e.preventDefault();
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      const m = /translateY\(([-\d.]+)px\)/.exec(panel.style.transform);
      const dy = m ? parseFloat(m[1]) : 0;
      const hh = panel.offsetHeight - 40;
      const isCollapsed = dy > hh / 2;
      panel.style.transform = '';
      if (!moved) { tripPanelToggle(); return; }
      if (isCollapsed) tripPanelCollapse(); else tripPanelOpen();
      if (map && map.resize) setTimeout(() => map.resize(), 300);
    };
    h.addEventListener('touchstart', onDown, { passive: true });
    h.addEventListener('touchmove', onMove, { passive: false });
    h.addEventListener('touchend', onUp);
    h.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
/* 两点球面距离（米） */
function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
/* 最近邻排序：从起点出发，每次选最近的未访问点，得到较优游览顺序 */
function orderByNearest(start, pts) {
  const rest = pts.slice();
  const out = [];
  let cur = start;
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach((p, i) => {
      const d = haversine(cur, [p.lng, p.lat]);
      if (d < bd) { bd = d; bi = i; }
    });
    const nx = rest.splice(bi, 1)[0];
    out.push(nx);
    cur = [nx.lng, nx.lat];
  }
  return out;
}
/* 用高德路径规划取两点间的路径（driving / walking / transit 公交地铁）；失败回退直线 */
function planSegment(a, b, mode, cb) {
  if (mode === 'transit') { planTransit(a, b, cb); return; }
  const url = 'https://restapi.amap.com/v3/direction/' + mode +
    '?key=' + encodeURIComponent(CONFIG.WEB_KEY) +
    '&origin=' + a.lng + ',' + a.lat + '&destination=' + b.lng + ',' + b.lat +
    '&extensions=all&output=json';
  fetch(url).then((r) => r.json()).then((j) => {
    let path = null, dist = 0, dur = 0;
    try {
      if (j.route && j.route.paths && j.route.paths[0]) {
        const p = j.route.paths[0];
        dist = parseInt(p.distance, 10) || 0;
        dur = parseInt(p.duration, 10) || 0;
        path = (p.steps || []).reduce((acc, s) => acc.concat((s.polyline || '').split(';')), [])
          .map((s) => s.split(',').map(Number)).filter((c) => c.length === 2 && !isNaN(c[0]));
      }
    } catch (e) { /* 忽略，走回退 */ }
    if (!path || !path.length) {
      dist = Math.round(haversine([a.lng, a.lat], [b.lng, b.lat]));
      dur = Math.round(dist / (mode === 'walking' ? 1.2 : 8.3));
      path = [[a.lng, a.lat], [b.lng, b.lat]];
    }
    cb({ path, dist, dur, mode, desc: '' });
  }).catch(() => {
    const dist = Math.round(haversine([a.lng, a.lat], [b.lng, b.lat]));
    const dur = Math.round(dist / (mode === 'walking' ? 1.2 : 8.3));
    cb({ path: [[a.lng, a.lat], [b.lng, b.lat]], dist, dur, mode, desc: '' });
  });
}
/* 公交 / 地铁路径规划：解析换乘方案，拼出可行走的折线 + 换乘说明 */
function planTransit(a, b, cb) {
  const city = cityCodeFor([a.lng, a.lat]);
  const url = 'https://restapi.amap.com/v3/direction/transit/integrated' +
    '?key=' + encodeURIComponent(CONFIG.WEB_KEY) +
    '&origin=' + a.lng + ',' + a.lat + '&destination=' + b.lng + ',' + b.lat +
    '&city=' + city + '&cityd=' + city + '&strategy=0&nightflag=0&output=json';
  fetch(url).then((r) => r.json()).then((j) => {
    let path = [], dist = 0, dur = 0, desc = '';
    try {
      const t = j.route && j.route.transits && j.route.transits[0];
      if (t) {
        dist = parseInt(t.distance, 10) || 0;
        dur = parseInt(t.duration, 10) || 0;
        const parts = [];
        (t.segments || []).forEach((s) => {
          // 步行段
          if (s.walking && s.walking.steps) {
            s.walking.steps.forEach((st) => {
              (st.polyline || '').split(';').forEach((c) => {
                const xy = c.split(',').map(Number);
                if (xy.length === 2 && !isNaN(xy[0])) path.push(xy);
              });
            });
          }
          // 乘车段
          if (s.bus && s.bus.buslines && s.bus.buslines[0]) {
            const bl = s.bus.buslines[0];
            (bl.polyline || '').split(';').forEach((c) => {
              const xy = c.split(',').map(Number);
              if (xy.length === 2 && !isNaN(xy[0])) path.push(xy);
            });
            const type = /地铁|轨交|磁浮/.test(bl.name || '') ? '🚇' : '🚌';
            const dep = bl.departure_stop && bl.departure_stop.name ? bl.departure_stop.name : '';
            const arr = bl.arrival_stop && bl.arrival_stop.name ? bl.arrival_stop.name : '';
            const via = bl.via_num ? '(' + bl.via_num + '站)' : '';
            parts.push(type + (bl.name || '公交') + via + (dep ? ' ' + dep + '→' + arr : ''));
          }
        });
        desc = parts.join('  ·  ');
      }
    } catch (e) { /* 忽略 */ }
    if (!path.length) {
      const dd = Math.round(haversine([a.lng, a.lat], [b.lng, b.lat]));
      cb({ path: [[a.lng, a.lat], [b.lng, b.lat]], dist: dd, dur: Math.round(dd / 6), mode: 'transit', desc: '' });
      return;
    }
    cb({ path, dist, dur, mode: 'transit', desc });
  }).catch(() => {
    const dd = Math.round(haversine([a.lng, a.lat], [b.lng, b.lat]));
    cb({ path: [[a.lng, a.lat], [b.lng, b.lat]], dist: dd, dur: Math.round(dd / 6), mode: 'transit', desc: '' });
  });
}
/* 粗判城市区号（高德 city 参数）：用经度粗略映射，命中常用城市；默认全国 010 不行，
 * 故用「按坐标找最近大城市」的简化表，失败则传空由高德自行推断 */
function cityCodeFor(lnglat) {
  const cities = [
    [121.4737, 31.2304, '021'],   // 上海
    [116.4074, 39.9042, '010'],   // 北京
    [113.2644, 23.1291, '020'],   // 广州
    [114.0579, 22.5431, '0755'],  // 深圳
    [120.1551, 30.2741, '0571'],  // 杭州
    [118.7969, 32.0603, '025'],   // 南京
    [104.0665, 30.5723, '028'],   // 成都
    [114.3055, 30.5928, '027'],   // 武汉
    [108.9480, 34.2632, '029'],   // 西安
    [113.6254, 34.7466, '0371'],  // 郑州
    [117.2009, 39.0842, '022'],   // 天津
    [120.5853, 31.2989, '0512'],  // 苏州
    [118.0894, 24.4798, '0592'],  // 厦门
    [120.6743, 27.9936, '0577'],  // 温州
    [121.5495, 29.8683, '0574'],  // 宁波
    [108.3665, 22.8170, '0771'],  // 南宁
  ];
  let best = '', bd = Infinity;
  cities.forEach((c) => {
    const d = haversine(lnglat, [c[0], c[1]]);
    if (d < bd) { bd = d; best = c[2]; }
  });
  return bd < 80000 ? best : '';
}
/* 一键规划：排序 + 逐段取路径 + 画线 + 汇总 */
function planRoute() {
  if (tripList.length < 2) { toast('请至少加入 2 个地点'); return; }
  const start = (currentCenter && currentCenter.length === 2)
    ? { lng: currentCenter[0], lat: currentCenter[1], name: '我的位置', isMe: true }
    : null;
  // 以「我的位置」为起点（若有）做最近邻排序
  const anchor = start ? [start.lng, start.lat] : [tripList[0].lng, tripList[0].lat];
  const ordered = orderByNearest(anchor, tripList.slice());
  tripList = ordered;
  renderTrip();

  clearTripRoute();
  toast('正在规划路线…');

  const pts = start ? [start].concat(ordered) : ordered.slice();
  const segs = [];
  let done = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    planSegment(a, b, tripMode, (res) => {
      segs[i] = res;
      done++;
      if (done === pts.length - 1) drawTripRoute(pts, segs);
    });
  }
}
/* 绘制路线与编号、汇总信息 */
function drawTripRoute(pts, segs) {
  // 编号标记
  pts.forEach((p, i) => {
    const isMe = !!p.isMe;
    const label = isMe ? '我' : String(i - (pts[0].isMe ? 1 : 0) + 1);
    const color = isMe ? '#2b6cff' : '#ff6b35';
    const m = new AMap.Marker({
      position: [p.lng, p.lat],
      content: `<div style="background:${color};color:#fff;width:26px;height:26px;border-radius:50%;
        display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;
        border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)">${label}</div>`,
      anchor: 'center',
      zIndex: 300,
    });
    m.setMap(map);
    tripMarkers.push(m);
  });
  // 路线折线（按出行方式配色：驾车蓝 / 步行绿 / 公交地铁橙）
  let totalDist = 0, totalDur = 0;
  const lineColor = tripMode === 'walking' ? '#12b76a' : (tripMode === 'transit' ? '#f79009' : '#2b6cff');
  segs.forEach((s, i) => {
    if (!s) return;
    totalDist += s.dist;
    totalDur += s.dur;
    const line = new AMap.Polyline({
      path: s.path,
      strokeColor: lineColor,
      strokeWeight: 5,
      strokeOpacity: 0.85,
      lineJoin: 'round',
      showDir: true,
      zIndex: 150,
    });
    line.setMap(map);
    tripPolylines.push(line);
  });
  map.setFitView(tripMarkers, false, [60, 60, 60, 60]);

  // 汇总
  const sum = document.getElementById('tripSum');
  const km = (totalDist / 1000).toFixed(1);
  const min = Math.round(totalDur / 60);
  const timeTxt = min >= 60 ? (Math.floor(min / 60) + ' 时 ' + (min % 60) + ' 分') : (min + ' 分钟');
  const nStop = pts.filter((p) => !p.isMe).length;
  const modeName = tripMode === 'walking' ? '步行' : (tripMode === 'transit' ? '公交地铁' : '驾车');
  let html = `📍 ${nStop} 个地点 · ${modeName}全程约 <b>${km} km</b> · 约 <b>${timeTxt}</b>` +
    (pts[0].isMe ? '（从我的位置出发）' : '');
  // 公交/地铁换乘说明
  if (tripMode === 'transit') {
    const lines = [];
    segs.forEach((s) => {
      if (s && s.desc) s.desc.split('  ·  ').forEach((d) => lines.push(d));
    });
    if (lines.length) {
      html += `<div class="trip-desc">${lines.map((d) => `<div class="trip-line">${escapeHtml(d)}</div>`).join('')}</div>`;
    }
  }
  if (sum) sum.innerHTML = html;
  toast('路线已生成：' + km + ' km / ' + timeTxt);
}
window.__tripAdd = tripAdd;

/* ====== 详情弹窗 ====== */
let infoWindow = null;
let currentDetail = null;

function renderNearbyBlock(arr, title, key, emptyText) {
  let inner;
  if (arr === undefined) inner = '<div class="row muted">加载中…</div>';
  else if (!arr.length) inner = `<div class="row muted">${emptyText}</div>`;
  else inner = `<ul class="iw-list">${arr.map((p, i) =>
    `<li class="iw-click" data-nb="${key}" data-idx="${i}"><b>${escapeHtml(p.name)}</b><span class="nd">${fmtDist(p.distance)}</span><span class="nb-go">详情 ›</span>${p.address ? `<br><span class="ne">${escapeHtml(p.address)}</span>` : ''}</li>`
  ).join('')}</ul>`;
  return `<div class="iw-sec"><div class="iw-sec-t">${title}（点击查看）</div>${inner}</div>`;
}

/* ====== 图片查看器（点击详情图片可放大 / 左右切换 / 滚轮缩放 / 拖拽） ====== */
let lbList = [];
let lbIdx = 0;
let lbScale = 1;
let lbX = 0;
let lbY = 0;
let lbDragging = false;
let lbMoved = false;
let lbStart = null;
function openLightbox(idx) {
  lbList = window.__photoUrls || [];
  if (!lbList.length) return;
  lbIdx = Math.max(0, Math.min(idx || 0, lbList.length - 1));
  let box = document.getElementById('lightbox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'lightbox';
    box.className = 'lightbox';
    box.innerHTML =
      '<span class="lb-close" onclick="window.__closeLightbox()">✕</span>' +
      '<span class="lb-prev" onclick="window.__lbStep(-1)">‹</span>' +
      '<img class="lb-img" id="lbImg" src="" alt="" draggable="false">' +
      '<span class="lb-next" onclick="window.__lbStep(1)">›</span>' +
      '<span class="lb-count" id="lbCount"></span>' +
      '<span class="lb-reset" id="lbReset" onclick="window.__lbReset()">重置</span>';
    box.addEventListener('click', (e) => { if (e.target === box) window.__closeLightbox(); });
    document.body.appendChild(box);

    const img = box.querySelector('#lbImg');
    // 滚轮缩放（以鼠标位置为中心）
    box.addEventListener('wheel', (e) => {
      if (!box.classList.contains('show')) return;
      e.preventDefault();
      const old = lbScale;
      const next = Math.min(6, Math.max(0.5, old * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      if (next === old) return;
      const rect = img.getBoundingClientRect();
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      const k = next / old;
      lbX = cx - (cx - lbX) * k;
      lbY = cy - (cy - lbY) * k;
      lbScale = next;
      applyLb();
    }, { passive: false });
    img.addEventListener('mousedown', (e) => {
      if (lbScale <= 1) return;
      lbDragging = true; lbMoved = false;
      lbStart = { x: e.clientX - lbX, y: e.clientY - lbY };
      img.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!lbDragging) return;
      lbX = e.clientX - lbStart.x;
      lbY = e.clientY - lbStart.y;
      lbMoved = true;
      applyLb();
    });
    window.addEventListener('mouseup', () => {
      if (!lbDragging) return;
      lbDragging = false;
      img.style.cursor = lbScale > 1 ? 'grab' : 'zoom-in';
    });
    img.addEventListener('dblclick', () => {
      lbScale = lbScale > 1 ? 1 : 2.5;
      if (lbScale === 1) { lbX = 0; lbY = 0; }
      applyLb();
    });
    let pinch = null;
    img.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1 && lbScale > 1) {
        lbDragging = true; lbMoved = false;
        lbStart = { x: e.touches[0].clientX - lbX, y: e.touches[0].clientY - lbY };
      } else if (e.touches.length === 2) {
        pinch = { d: touchDist(e), s: lbScale };
      }
    }, { passive: false });
    img.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && lbDragging) {
        lbX = e.touches[0].clientX - lbStart.x;
        lbY = e.touches[0].clientY - lbStart.y;
        lbMoved = true;
        applyLb();
        e.preventDefault();
      } else if (e.touches.length === 2 && pinch) {
        lbScale = Math.min(6, Math.max(0.5, pinch.s * (touchDist(e) / pinch.d)));
        applyLb();
        e.preventDefault();
      }
    }, { passive: false });
    img.addEventListener('touchend', () => { lbDragging = false; pinch = null; img.style.cursor = lbScale > 1 ? 'grab' : 'zoom-in'; });

    document.addEventListener('keydown', (e) => {
      const b = document.getElementById('lightbox');
      if (!b || !b.classList.contains('show')) return;
      if (e.key === 'Escape') window.__closeLightbox();
      else if (e.key === 'ArrowLeft') window.__lbStep(-1);
      else if (e.key === 'ArrowRight') window.__lbStep(1);
      else if (e.key === '0') window.__lbReset();
    });
  }
  resetLb();
  updateLightbox();
  box.classList.add('show');
}
function touchDist(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy) || 1;
}
function applyLb() {
  const img = document.getElementById('lbImg');
  const box = document.getElementById('lightbox');
  if (!img) return;
  img.style.transform = 'translate(' + lbX + 'px,' + lbY + 'px) scale(' + lbScale + ')';
  img.style.cursor = lbScale > 1 ? (lbDragging ? 'grabbing' : 'grab') : 'zoom-in';
  const r = document.getElementById('lbReset');
  if (r) r.style.display = lbScale !== 1 ? '' : 'none';
  if (box) box.classList.toggle('zoomed', lbScale > 1);
}
function resetLb() {
  lbScale = 1; lbX = 0; lbY = 0; lbDragging = false;
  const img = document.getElementById('lbImg');
  if (img) { img.style.transition = 'transform .18s ease'; img.style.transform = ''; setTimeout(() => { if (img) img.style.transition = ''; }, 200); }
  const r = document.getElementById('lbReset');
  if (r) r.style.display = 'none';
  const box = document.getElementById('lightbox');
  if (box) box.classList.remove('zoomed');
}
function updateLightbox() {
  const img = document.getElementById('lbImg');
  const cnt = document.getElementById('lbCount');
  const box = document.getElementById('lightbox');
  if (!img || !box) return;
  resetLb();
  img.src = lbList[lbIdx];
  if (cnt) cnt.textContent = (lbIdx + 1) + ' / ' + lbList.length;
  const prev = box.querySelector('.lb-prev');
  const next = box.querySelector('.lb-next');
  const multi = lbList.length > 1;
  if (prev) prev.style.display = multi ? '' : 'none';
  if (next) next.style.display = multi ? '' : 'none';
}
function lbStep(d) {
  if (!lbList.length) return;
  lbIdx = (lbIdx + d + lbList.length) % lbList.length;
  updateLightbox();
}
function closeLightbox() {
  const box = document.getElementById('lightbox');
  if (box) box.classList.remove('show');
  const img = document.getElementById('lbImg');
  if (img) img.src = '';
  resetLb();
}
window.__openLightbox = openLightbox;
window.__closeLightbox = closeLightbox;
window.__lbStep = lbStep;
window.__lbReset = resetLb;

function detailHtml(poi, o, pType) {
  const pos = [poi.location.lng, poi.location.lat];
  // 门票 / 价格（参考值）
  let priceRow = '';
  if (pType === 'scene') {
    const b = priceBadge('scene', poi);
    if (b) priceRow = `<div class="row"><b>门票：</b><span class="tag ${b.cls}">${b.txt}</span>${b.cls === 'unknown' ? ' <span class="muted">（高德未收录票价）</span>' : ''}</div>`;
  } else if (pType === 'hotel') {
    const b = priceBadge('hotel', poi);
    if (b) priceRow = `<div class="row"><b>参考人均：</b><span class="tag ${b.cls}">${b.txt}</span>${b.cls === 'unknown' ? ' <span class="muted">（高德未收录）</span>' : ' <span class="muted">（人均消费参考，非实时房价，点「去携程」看真实房价）</span>'}</div>`;
  }
  const ctripBtn = (pType === 'hotel' || pType === 'scene')
    ? `<a class="ctrip" href="${ctripSearchUrl(pType, poi.name)}" target="_blank" rel="noopener">去携程看真实价格</a>`
    : '';
  const photoUrls = (o.photos || []).slice(0, 4).map((p) => (typeof p === 'string' ? p : (p && p.url) || '')).filter(Boolean);
  const imgs = photoUrls.map((url, idx) =>
    `<img class="iw-img" src="${escapeHtml(url)}" data-idx="${idx}" onclick="window.__openLightbox(${idx})" onerror="this.remove()">`
  ).join('');
  const imgBlock = imgs
    ? `<div class="iw-imgs">${imgs}</div>`
    : '<div class="row muted">高德暂未收录该地点的图片</div>';
  window.__photoUrls = photoUrls;
  const descHtml = o.desc
    ? `<div class="row desc">📝 ${escapeHtml(o.desc)}</div>`
    : '<div class="row muted">高德暂未收录简介</div>';
  const costHtml = o.cost ? `<div class="row"><b>人均：</b>¥${escapeHtml(o.cost)}</div>` : '';
  const bizHtml = o.business ? `<div class="row"><b>营业时间：</b>${escapeHtml(o.business)}</div>` : '';
  const revHtml = (o.reviews && o.reviews.length)
    ? ('<div class="row muted" style="font-size:11px">评价来源：' +
        (o.reviewsFromGoogle ? 'Google' : '高德') + '</div>' +
        o.reviews.slice(0, 3).map((r) => {
          const c = r && r.content ? escapeHtml(r.content) : '';
          return c ? `<div class="row review">💬 ${c}</div>` : '';
        }).join(''))
    : '<div class="row muted">高德公开接口不提供用户评论（仅评分）' +
        (CONFIG.GOOGLE_KEY ? '；Google 兜底也未能获取（可能被墙或未收录）' : '；可在 app.js 填入 GOOGLE_KEY 用 Google 补充') +
        '</div>';
  const rating = o.rating ? `<div class="row"><b>评分：</b>${o.rating} 分</div>` : '';
  const tel = o.tel ? `<div class="row"><b>电话：</b>${escapeHtml(o.tel.split(';')[0])}</div>` : '';
  const type = o.type ? `<div class="row"><b>类型：</b>${escapeHtml(o.type.split(';')[0])}</div>` : '';

  const shopBlock = renderNearbyBlock(
    o.shops, '🛍️ 周边好店 · 美食', 'shops',
    '附近暂无收录的店铺或美食'
  );
  const eventBlock = renderNearbyBlock(
    o.events, '🎪 近期活动', 'events',
    '高德暂未收录该地点周边的活动信息'
  );

  return `
    <div class="iw">
      <h4>${escapeHtml(poi.name)}</h4>
      ${imgBlock}
      <div class="row"><b>地址：</b>${escapeHtml(poi.address || '暂无')}</div>
      ${type}${priceRow}${rating}${costHtml}${tel}${bizHtml}
      <div class="row"><b>距您：</b>${fmtDist(poi.distance)}</div>
      ${descHtml}
      ${shopBlock}
      ${eventBlock}
      ${revHtml}
      <div class="btns">
        <a class="go" data-act="nav" href="javascript:void(0)">🧭 导航（地图内）</a>
        <a class="go out" data-act="navout" href="javascript:void(0)">高德打开</a>
        ${ctripBtn}
        <a class="close" data-act="close" href="javascript:void(0)">关闭</a>
      </div>
    </div>`;
}

function loadNearby(poi, keyword, radius, cb) {
  if (!detailSearch || !poi.location) { cb([]); return; }
  detailSearch.searchNearBy(keyword, [poi.location.lng, poi.location.lat], radius, (status, result) => {
    if (status === 'complete' && result.poiList) {
      const list = (result.poiList.pois || [])
        .filter((p) => p.id !== (poi.id || null))
        .sort((a, b) => (a.distance || 0) - (b.distance || 0))
        .slice(0, 6)
        .map((p) => p); // 保留完整 POI（含 location/photos 等），供点击查看详情
      cb(list);
    } else {
      cb([]);
    }
  });
}

/* 点击详情里的「周边好店/活动」列表项 → 打开该地点的详情。
 * 用事件委托（而非内联 onclick），这样高德信息窗体重设内容后依然有效。 */
function openNearby(key, i) {
  try {
    if (!currentDetail) { toast('请稍候，详情尚未加载完'); return; }
    const arr = key === 'shops' ? currentDetail.o.shops : currentDetail.o.events;
    const p = arr && arr[i];
    if (!p) { toast('该条目暂无详情数据'); return; }
    if (!p.location) { toast('该地点缺少坐标信息，无法查看'); return; }
    openDetail(p);
  } catch (err) {
    toast('打开详情失败：' + (err && err.message ? err.message : '未知错误'));
  }
}
window.__openNearby = openNearby;
function bindNearbyClicks() {
  document.addEventListener('click', (e) => {
    const li = e.target && e.target.closest ? e.target.closest('.iw-click') : null;
    if (!li) return;
    e.stopPropagation();
    openNearby(li.getAttribute('data-nb'), parseInt(li.getAttribute('data-idx'), 10));
  });
}

function renderCurrentDetail() {
  if (currentDetail && infoWindow) {
    infoWindow.setContent(detailHtml(currentDetail.poi, currentDetail.o, currentDetail.type));
    bindDetailButtons();
  }
}
/* 绑定详情窗按钮（地图内导航 / 高德打开 / 携程 / 关闭），避免 href 跳转 */
function bindDetailButtons() {
  const poi = currentDetail && currentDetail.poi;
  if (!poi || !poi.location) return;
  const pos = [poi.location.lng, poi.location.lat];
  const host = document.querySelector('.amap-info-content') || document;
  host.querySelectorAll('[data-act]').forEach((el) => {
    const act = el.getAttribute('data-act');
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (act === 'nav') navigateTo(pos[0], pos[1], poi.name);
      else if (act === 'navout') navigateExternal(pos[0], pos[1], poi.name);
      else if (act === 'ctrip') openCtrip(poi.name);
      else if (act === 'close') window.__closeIw();
    };
  });
}

/* ====== Google Places 兜底（高德缺数据时补充评分/评价/图片） ====== */
let gmapLoading = false;
let gPlaces = null;
function loadGoogleMaps(cb) {
  if (window.google && window.google.maps && window.google.maps.places && gPlaces) { cb(); return; }
  if (gmapLoading) {
    const t = setInterval(() => {
      if (gPlaces) { clearInterval(t); cb(); }
    }, 200);
    setTimeout(() => clearInterval(t), 12000);
    return;
  }
  gmapLoading = true;
  const s = document.createElement('script');
  s.src = 'https://maps.googleapis.com/maps/api/js?key=' +
    encodeURIComponent(CONFIG.GOOGLE_KEY) + '&libraries=places&callback=__gmCallback';
  window.__gmCallback = () => {
    try {
      gPlaces = new google.maps.places.PlacesService(document.createElement('div'));
      cb();
    } catch (e) { console.warn('Google Places 初始化失败', e); }
  };
  s.async = true;
  s.onerror = () => toast('Google 地图加载失败（国内可能被墙，需境外/挂 VPN）');
  document.head.appendChild(s);
}

function enrichFromGoogle(poi, o, done) {
  if (!CONFIG.GOOGLE_KEY) { done(); return; }
  loadGoogleMaps(() => {
    if (!gPlaces) { done(); return; }
    const query = (poi.name || '') + ' ' + (poi.cityname || poi.address || '');
    const req = {
      query,
      location: new google.maps.LatLng(poi.location.lat, poi.location.lng),
      radius: 3000,
    };
    gPlaces.textSearch(req, (results, status) => {
      if (status !== 'OK' || !results || !results.length) { done(); return; }
      const placeId = results[0].place_id;
      if (!o.rating && results[0].rating) o.rating = results[0].rating;
      gPlaces.getDetails(
        { placeId, fields: ['rating', 'reviews', 'photos', 'formatted_address', 'website'] },
        (detail, ds) => {
          if (ds === 'OK' && detail) {
            if (!o.rating && detail.rating) o.rating = detail.rating;
            if (detail.reviews && detail.reviews.length) {
              o.reviewsFromGoogle = true;
              o.reviews = detail.reviews.slice(0, 3).map((r) => ({
                content: (r.author_name ? '【' + r.author_name + '】' : '') + (r.text || ''),
                rating: r.rating,
              }));
            }
            if (detail.photos && detail.photos.length) {
              o.photos = detail.photos.slice(0, 4).map((ph) =>
                ph.getUrl({ maxWidth: 400, maxHeight: 300 }));
            }
          }
          done();
        }
      );
    });
  });
}

function openDetail(poi, type) {
  type = type || currentType;
  const loc = poi.location;
  if (!loc) return;
  const pos = [loc.lng, loc.lat];
  const o = {
    rating: poi.rating || '', tel: poi.tel || '', type: poi.type || '',
    photos: poi.photos || [], desc: poi.description || '', reviews: [],
    cost: '', business: '', shops: undefined, events: undefined,
  };
  currentDetail = { poi, o, type };

  if (!infoWindow) infoWindow = new AMap.InfoWindow({ offset: new AMap.Pixel(0, -30), isCustom: false });
  renderCurrentDetail();
  infoWindow.open(map, pos);
  map.setZoomAndCenter(16, pos);

  if (poi.id && CONFIG.WEB_KEY) {
    const url = `https://restapi.amap.com/v3/place/detail?key=${encodeURIComponent(CONFIG.WEB_KEY)}&id=${encodeURIComponent(poi.id)}`;
    fetch(url).then((r) => r.json()).then((j) => {
      // 高德 Web 服务 detail 返回的是 pois 数组（非 poi），评分/票价/营业时间在 biz_ext 子对象里
      const d = (j.status === '1' && j.pois && j.pois[0]) ? j.pois[0] : null;
      if (d) {
        const be = d.biz_ext || {};
        const rating = be.rating || d.rating;
        if (rating) o.rating = o.rating || rating;
        const telRaw = d.tel;
        const tel = Array.isArray(telRaw) ? (telRaw[0] || '') : (telRaw || '');
        if (tel) o.tel = tel;
        if (d.type) o.type = o.type || d.type;
        if (d.photos && d.photos.length) o.photos = d.photos;
        if (d.description) o.desc = o.desc || d.description;
        const costArr = be.cost;
        const cost = (Array.isArray(costArr) && costArr.length) ? costArr[0] : (d.cost || '');
        o.cost = cost || '';
        if (cost) poi.cost = cost;   // 同步给门票/价格标签
        const openArr = be.opentime2;
        o.business = (Array.isArray(openArr) && openArr.length) ? openArr[0] : (d.business || o.business);
        if (currentDetail && currentDetail.poi === poi) renderCurrentDetail();
      }
    }).catch(() => {});
  } else if (poi.id && placeSearch && typeof placeSearch.getDetails === 'function') {
    placeSearch.getDetails(poi.id, (status, result) => {
      if (status === 'complete' && result && result.poi) {
        const d = result.poi;
        o.photos = d.photos || o.photos;
        o.desc = d.description || o.desc;
        if (currentDetail && currentDetail.poi === poi) renderCurrentDetail();
      }
    });
  }

  loadNearby(poi, SHOP_KEYWORDS, 800, (list) => { o.shops = list; renderCurrentDetail(); });
  loadNearby(poi, EVENT_KEYWORDS, 1500, (list) => { o.events = list; renderCurrentDetail(); });

  // 高德数据不足时，用 Google 补充评分/评价/图片（国内被墙会自动失效，不影响主功能）
  const needGoogle = CONFIG.GOOGLE_KEY &&
    (!o.photos || !o.photos.length || !o.rating || !(o.reviews && o.reviews.length));
  if (needGoogle) {
    enrichFromGoogle(poi, o, () => {
      if (currentDetail && currentDetail.poi === poi) renderCurrentDetail();
    });
  }
}
window.__closeIw = () => { if (infoWindow) infoWindow.close(); };

/* ====== 图层切换 ====== */
function toggleLayer() {
  if (!map) return;
  isSatellite = !isSatellite;
  if (isSatellite) {
    map.add([satellite, roadNet]);
    document.getElementById('layerBtn').classList.add('active');
    document.getElementById('layerBtn').textContent = '🗺️ 切换普通图';
    toast('已切换：卫星图');
  } else {
    map.remove([satellite, roadNet]);
    document.getElementById('layerBtn').classList.remove('active');
    document.getElementById('layerBtn').textContent = '🌍 切换卫星图';
    toast('已切换：普通图');
  }
}

/* ====== 搜索城市 / 地址（桌面端核心：不依赖定位也能测） ====== */
/* ====== 搜索地点（按名称关键字，全国范围） ====== */
let searchMode = null;   // 当前搜索关键词；非 null 表示处于「搜索结果」模式

function poiMeta(poi) {
  const t = (poi.type || '').toLowerCase();
  if (/酒店|住宿|旅馆|客栈|宾馆|旅舍|民宿/.test(t)) return { icon: '🏨', color: '#2b6cff', kind: 'hotel' };
  if (/景点|旅游|公园|风景区|乐园|博物馆|展览馆|古迹|遗址|寺庙|庵|山|湖|岛|海滨|温泉|植物园|动物园/.test(t)) return { icon: '🏞️', color: '#ff6b35', kind: 'scene' };
  if (/美食|餐饮|餐厅|小吃|咖啡|蛋糕|酒吧|茶馆/.test(t)) return { icon: '🍜', color: '#e85a25', kind: 'scene' };
  if (/购物|商场|购物中心|超市|商业|百货|商铺/.test(t)) return { icon: '🛍️', color: '#c0392b', kind: 'scene' };
  return { icon: '📍', color: '#7a5cff', kind: 'scene' };
}

function clearSearch() {
  searchMode = null;
  const banner = document.getElementById('searchBanner');
  if (banner) banner.hidden = true;
}

function searchPlaces(kw) {
  kw = (kw || '').trim();
  if (!kw) return;
  if (!placeSearch) { toast('地图尚未就绪，请稍候'); return; }
  toast('正在搜索：' + kw);
  placeSearch.search(kw, (status, result) => {
    if (status === 'complete' && result.poiList && result.poiList.pois.length) {
      searchMode = kw;
      renderSearch(kw, result.poiList.pois);
    } else if (status === 'no_data') {
      searchMode = kw;
      renderSearch(kw, []);
      toast('未找到相关地点');
    } else {
      toast('搜索失败，请稍后重试');
      console.error('search error:', status, result);
    }
  });
}

function renderSearch(kw, pois) {
  clearMarkers();
  const body = document.getElementById('list');
  const countEl = document.getElementById('listCount');
  const titleEl = document.getElementById('listTitle');
  body.innerHTML = '';
  lastPois = [];
  sceneCache = [];

  // 显示「搜索结果」横幅 + 返回附近按钮
  const banner = document.getElementById('searchBanner');
  if (banner) {
    banner.hidden = false;
    banner.querySelector('.sb-kw').textContent = kw;
    banner.querySelector('.sb-n').textContent = pois.length;
  }
  const sf = document.getElementById('sceneFilter');
  if (sf) sf.hidden = true;   // 搜索结果不走「免费/收费」筛选

  if (!pois.length) {
    body.innerHTML = '<div class="empty">未找到与「' + escapeHtml(kw) + '」相关的地点<br>换个关键词，或点上方「返回附近」</div>';
    countEl.textContent = '';
    titleEl.textContent = '搜索结果';
    return;
  }

  titleEl.textContent = '搜索结果';
  countEl.textContent = pois.length + ' 个地点';

  // 计算中心点（用于切换分类后展示周边，以及显示距离）
  let sx = 0, sy = 0, n = 0;
  pois.forEach((p) => { if (p.location) { sx += p.location.lng; sy += p.location.lat; n++; } });
  if (n) { currentCenter = [sx / n, sy / n]; updateMeMarker(currentCenter); }

  const bounds = [];
  pois.forEach((poi, i) => {
    const loc = poi.location;
    if (!loc) return;
    const pos = [loc.lng, loc.lat];
    bounds.push(pos);
    const meta = poiMeta(poi);
    const marker = makeMarker(pos, meta.icon, meta.color);
    marker.on('click', () => openDetail(poi, meta.kind));
    marker.setMap(map);
    markers.push(marker);

    let distTxt = '';
    if (poi.distance) distTxt = fmtDist(poi.distance);
    else if (currentCenter) distTxt = fmtDist(distMeters(currentCenter, pos));

    const rating = poi.rating ? `<span class="tag">评分 ${poi.rating}</span>` : '';
    const badge = priceBadge(meta.kind, poi);
    const badgeHtml = badge ? `<span class="tag ${badge.cls}">${badge.txt}</span>` : '';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="thumb">${meta.icon}</div>
      <div class="info">
        <p class="name">${escapeHtml(poi.name)}</p>
        <div class="meta">
          <span class="dist">${distTxt}</span>
          ${badgeHtml}${rating}<br>
          <span>${escapeHtml(poi.address || '暂无地址')}</span>
        </div>
        <div class="actions">
          <button class="mini-btn map" data-i="${i}">看地图</button>
          <button class="mini-btn nav" data-i="${i}">导航</button>
        </div>
      </div>`;
    card.querySelector('.map').onclick = (e) => { e.stopPropagation(); focusPoint(pos[0], pos[1]); openDetail(poi, meta.kind); };
    card.querySelector('.nav').onclick = (e) => { e.stopPropagation(); navigateTo(pos[0], pos[1], poi.name); };
    card.onclick = () => { focusPoint(pos[0], pos[1]); openDetail(poi, meta.kind); };
    body.appendChild(card);
  });

  fitToPoints(bounds);
}

/* 把地图视野移动到一组点（搜索结果）。用 setBounds 显式计算边界，避免 setFitView
 * 在某些时机不生效，导致地图仍停在默认城市（乐清）。 */
function fitToPoints(pts) {
  if (!map || !pts || !pts.length) return;
  if (pts.length === 1) {
    map.setZoomAndCenter(14, pts[0]);
    return;
  }
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  pts.forEach((p) => {
    if (p[0] < minLng) minLng = p[0];
    if (p[0] > maxLng) maxLng = p[0];
    if (p[1] < minLat) minLat = p[1];
    if (p[1] > maxLat) maxLat = p[1];
  });
  const sw = new AMap.LngLat(minLng, minLat);
  const ne = new AMap.LngLat(maxLng, maxLat);
  try {
    map.setBounds(new AMap.Bounds(sw, ne), false, [40, 40, 40, 40]);
  } catch (e) {
    // 兜底：直接中心缩放
    map.setZoomAndCenter(13, [(minLng + maxLng) / 2, (minLat + maxLat) / 2]);
  }
}

/* ====== 定位 ====== */
function onPositionUpdate(pos) {
  const c = [pos.coords.longitude, pos.coords.latitude];
  // 若用户已发起「按名称搜索」，定位回调晚到时不要覆盖搜索结果、也不要把地图拉回当前位置
  if (searchMode) {
    currentCenter = c;
    updateMeMarker(c);
    return;
  }
  currentCenter = c;
  updateMeMarker(c);
  if (!map) {
    initMap(c);
    switchCategory(currentType);
  } else {
    map.setZoomAndCenter(14, c);
    switchCategory(currentType);
  }
}

function locate() {
  if (!navigator.geolocation) { useDefault(); return; }
  toast('定位中…');
  navigator.geolocation.getCurrentPosition(
    onPositionUpdate,
    (err) => {
      console.warn('定位失败，使用默认中心：', err && err.message);
      useDefault();
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 3000 }
  );
}

function useDefault() {
  if (currentCenter) return;
  currentCenter = DEFAULT_CENTER.slice();
  initMap(currentCenter);
  setListTitle(DEFAULT_CITY + '周边');
  switchCategory(currentType);
  showNotice('未获取到您的定位（浏览器未授权或不可用），已默认显示「' + DEFAULT_CITY + '」。可在左上角搜索任意城市，或点「📍 我的位置」授权定位。');
}

function showNotice(msg) {
  const n = document.getElementById('notice');
  n.textContent = msg;
  n.hidden = false;
}
function hideNotice() {
  const n = document.getElementById('notice');
  if (n) n.hidden = true;
}

/* ====== 分类切换 ====== */
function setListTitle(t) {
  document.getElementById('listTitle').textContent = t;
}
function switchCategory(type, keepTitle) {
  currentType = type;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.type === type));
  if (!keepTitle) setListTitle(CATEGORIES[type].label);
  const sf = document.getElementById('sceneFilter');
  if (sf) sf.hidden = (type !== 'scene');
  clearSearch();   // 切换分类即退出「搜索结果」模式，回到周边
  if (type === 'guide') renderGuides();
  else searchNearby(type);
}

/* ====== 环境自检 / 加载失败兜底（避免“一片空白”无信息） ====== */
function showDiag(html) {
  let d = document.getElementById('diagBox');
  if (!d) {
    d = document.createElement('div');
    d.id = 'diagBox';
    d.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);max-width:540px;background:#fff;border:2px solid #ff6b35;border-radius:14px;padding:18px 20px;box-shadow:0 10px 40px rgba(0,0,0,.22);z-index:99999;font-size:14px;line-height:1.7;color:#1c2330';
    document.body.appendChild(d);
  }
  d.innerHTML = html;
}
function updateDiag(line) {
  const d = document.getElementById('diagBox');
  if (!d) return;
  // 把新行插入到“建议”段落之前
  const tip = d.querySelector('.diag-tip');
  if (tip) tip.insertAdjacentHTML('beforebegin', line + '<br>');
  else d.insertAdjacentHTML('beforeend', line + '<br>');
}
function runDiag() {
  const inIframe = window.top !== window.self;
  const amapOk = typeof window.AMap !== 'undefined';
  const mapEl = document.getElementById('map');
  const h = mapEl ? mapEl.clientHeight : 0;
  // WebGL 支持检测（高德 2.0 矢量渲染需要）
  let webglOk = false;
  try {
    const cv = document.createElement('canvas');
    webglOk = !!(cv.getContext('webgl') || cv.getContext('experimental-webgl'));
  } catch (e) { webglOk = false; }
  const tip = '<div class="diag-tip" style="margin-top:10px;color:#e85a25">建议：请用电脑 Chrome / Edge <b>独立窗口</b>打开本页链接（复制地址栏链接→打开浏览器→粘贴→回车），不要用 WorkBuddy 预览面板 / 内置浏览器。若仍失败，按 F12 打开 Console，把红色报错截图发我。</div>';
  let info = '⚠️ 地图未能加载。环境自检：<br>';
  info += '· 运行位置：' + (inIframe ? '<b style="color:#e85a25">iframe（预览面板 / 内置浏览器，常拦截外部 JS）</b>' : '独立窗口') + '<br>';
  info += '· 高德 JS：' + (amapOk ? '已加载' : '<b style="color:#e85a25">未加载（网络被挡或脚本被拦）</b>') + '<br>';
  info += '· WebGL 渲染：' + (webglOk ? '支持' : '<b style="color:#e85a25">不支持（高德 2.0 需要 WebGL，请换 Chrome/Edge 或更新显卡驱动）</b>') + '<br>';
  info += '· 地图容器高度：' + h + 'px（若为 0 说明页面样式未加载）<br>';
  info += '· 高德服务器连通性：探测中…<br>' + tip;
  showDiag(info);
  fetch('https://webapi.amap.com/maps?v=1.4.15&key=' + encodeURIComponent(CONFIG.AMAP_KEY) + '&plugin=AMap.PlaceSearch', { mode: 'cors' })
    .then((r) => updateDiag('· 高德服务器连通性：HTTP ' + r.status + '（可达）'))
    .catch((e) => updateDiag('· 高德服务器连通性：<b style="color:#e85a25">失败 ' + e.message + '</b>（你的网络 / 环境连不上高德）'));
}

/* ====== 动态加载高德 JS API ====== */
function loadAmapJs(cb) {
  if (typeof AMap !== 'undefined') { cb(); return; }
  if (CONFIG.SECURITY_CODE) {
    window._AMapSecurityConfig = { securityJsCode: CONFIG.SECURITY_CODE };
  }
  const s = document.createElement('script');
  // v1.4.15：栅格瓦片（图片）渲染，不依赖 WebGL，兼容性最好。
  // v2.0 用 WebGL 画矢量底图，部分电脑显卡/驱动/远程桌面会渲染失败 → 底图空白但标记可见。
  s.src = 'https://webapi.amap.com/maps?v=1.4.15&key=' +
    encodeURIComponent(CONFIG.AMAP_KEY) +
    '&plugin=AMap.PlaceSearch,AMap.Geolocation';
  s.async = true;
  s.onload = cb;
  s.onerror = () => { toast('高德地图脚本加载失败，请检查网络'); runDiag(); };
  document.head.appendChild(s);
}

/* ====== 启动 ====== */
function boot() {
  bindNearbyClicks();   // 详情里「周边好店/活动」列表项点击 → 打开详情
  // 我的行程面板
  const tripGo = document.getElementById('tripGo');
  if (tripGo) tripGo.addEventListener('click', planRoute);
  const tripClearBtn = document.getElementById('tripClear');
  if (tripClearBtn) tripClearBtn.addEventListener('click', tripClear);
  const tripCloseBtn = document.getElementById('tripClose');
  if (tripCloseBtn) tripCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    tripPanelCollapse();
  });
  bindTripDrawer();
  const tripFab = document.getElementById('tripFab');
  if (tripFab) tripFab.addEventListener('click', () => {
    const p = document.getElementById('tripPanel');
    if (p) { p.hidden = false; tripPanelOpen(); renderTrip(); }
  });
  document.querySelectorAll('input[name="tripMode"]').forEach((r) => {
    r.addEventListener('change', () => {
      tripMode = r.value;
      if (tripList.length >= 2) planRoute();
    });
  });
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) switchCategory(btn.dataset.type);
  });

  document.getElementById('layerBtn').addEventListener('click', toggleLayer);

  // 景点「免费 / 收费」筛选（不重复请求，直接基于上次结果）
  const sf = document.getElementById('sceneFilter');
  if (sf) sf.addEventListener('click', (e) => {
    const b = e.target.closest('.fbtn');
    if (!b) return;
    sceneFilter = b.dataset.f;
    sf.querySelectorAll('.fbtn').forEach((x) => x.classList.toggle('active', x === b));
    if (currentType === 'scene') renderResults('scene', lastPois);
  });

  document.getElementById('locateBtn').addEventListener('click', () => {
    if (currentCenter) { map.setZoomAndCenter(14, currentCenter); toast('已回到我的位置'); }
    else locate();
  });

  const box = document.getElementById('searchBox');
  const doSearch = () => { searchPlaces(box.value); };
  document.getElementById('searchBtn').addEventListener('click', doSearch);
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  // 搜索结果横幅「返回附近」按钮
  const sb = document.getElementById('searchBanner');
  if (sb) sb.querySelector('.sb-back').addEventListener('click', () => {
    clearSearch();
    switchCategory(currentType);
  });

  const cfgClose = document.getElementById('configClose');
  if (cfgClose) cfgClose.addEventListener('click', () => {
    document.getElementById('configTip').hidden = true;
  });

  if (CONFIG.AMAP_KEY === 'YOUR_AMAP_KEY') {
    document.getElementById('configTip').hidden = false;
    return;
  }

  loadAmapJs(() => {
    // 先尝试浏览器定位；失败则回退到默认城市，保证网页可测
    locate();
  });

  // 兜底诊断：若 7 秒后地图仍未渲染，弹出环境自检，避免“一片空白”无信息
  setTimeout(() => {
    const m = document.getElementById('map');
    const amapCount = m ? m.querySelectorAll('[class*="amap"]').length : 0;
    if (!map && amapCount === 0) runDiag();
  }, 7000);
}

document.addEventListener('DOMContentLoaded', boot);
