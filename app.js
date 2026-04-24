const DEFAULT_DATA_URL = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';
const PRESET_POSTAL_CENTERS = {
  '28033': { lat: 40.474405, lon: -3.654314, label: 'Madrid 28033' },
  '28043': { lat: 40.456900, lon: -3.648700, label: 'Madrid 28043' },
  '28036': { lat: 40.468300, lon: -3.678700, label: 'Madrid 28036' }
};
const DEFAULT_BRANDS = ['REPSOL', 'CEPSA', 'BP', 'SHELL', 'GALP', 'PLENOIL', 'BALLENOIL', 'PETRONOR'];
const FAVORITES_KEY = 'fuelmap:favorites:v3.7.3';
const SETTINGS_KEY = 'fuelmap:settings:v3.7.3';
const LEGACY_FAVORITES_KEYS = ['fuelmap:favorites:v3.7', 'fuelmap:favorites:v3.6', 'fuelmap:favorites:v3.5', 'fuelmap:favorites:v3.4'];
const LEGACY_SETTINGS_KEYS = ['fuelmap:settings:v3.7', 'fuelmap:settings:v3.6', 'fuelmap:settings:v3.5', 'fuelmap:settings:v3.4'];
const CACHE_DB_NAME = 'fuelmap-browser-db';
const CACHE_STORE_NAME = 'appState';

const els = {
  geoBtn: document.getElementById('geoBtn'),
  loadBtn: document.getElementById('loadBtn'),
  helpBtn: document.getElementById('helpBtn'),
  closeHelpBtn: document.getElementById('closeHelpBtn'),
  helpDialog: document.getElementById('helpDialog'),
  clearOriginBtn: document.getElementById('clearOriginBtn'),
  refreshFiltersBtn: document.getElementById('refreshFiltersBtn'),
  exportBtn: document.getElementById('exportBtn'),
  clearFavoritesBtn: document.getElementById('clearFavoritesBtn'),
  selectAllBrandsBtn: document.getElementById('selectAllBrandsBtn'),
  clearBrandsBtn: document.getElementById('clearBrandsBtn'),
  recommendedBrandsBtn: document.getElementById('recommendedBrandsBtn'),
  processJsonBtn: document.getElementById('processJsonBtn'),
  restoreMineturBtn: document.getElementById('restoreMineturBtn'),
  clearJsonBtn: document.getElementById('clearJsonBtn'),
  jsonFileInput: document.getElementById('jsonFileInput'),

  latitudeInput: document.getElementById('latitudeInput'),
  longitudeInput: document.getElementById('longitudeInput'),
  postalCodeInput: document.getElementById('postalCodeInput'),
  maxDistanceInput: document.getElementById('maxDistanceInput'),
  addressInput: document.getElementById('addressInput'),
  resultSearchInput: document.getElementById('resultSearchInput'),
  consumptionInput: document.getElementById('consumptionInput'),
  tripTypeInput: document.getElementById('tripTypeInput'),
  fuelTypeInput: document.getElementById('fuelTypeInput'),
  tankCapacityInput: document.getElementById('tankCapacityInput'),
  limitInput: document.getElementById('limitInput'),
  sortByInput: document.getElementById('sortByInput'),
  favoriteModeInput: document.getElementById('favoriteModeInput'),
  showOnlyPricedInput: document.getElementById('showOnlyPricedInput'),
  dataUrlInput: document.getElementById('dataUrlInput'),
  customBrandInput: document.getElementById('customBrandInput'),
  manualJsonInput: document.getElementById('manualJsonInput'),

  brandChips: document.getElementById('brandChips'),
  originModeBadge: document.getElementById('originModeBadge'),
  statusText: document.getElementById('statusText'),
  stationCount: document.getElementById('stationCount'),
  minPumpPrice: document.getElementById('minPumpPrice'),
  favoriteCount: document.getElementById('favoriteCount'),
  datasetDate: document.getElementById('datasetDate'),
  sourceText: document.getElementById('sourceText'),
  fetchedAtText: document.getElementById('fetchedAtText'),
  rowCountText: document.getElementById('rowCountText'),
  activeBrandsText: document.getElementById('activeBrandsText'),
  bestCard: document.getElementById('bestCard'),
  cardsContainer: document.getElementById('cardsContainer')
};

let selectedBrands = new Set(['REPSOL']);
let favoriteIds = new Set(loadFavorites());
let currentDataset = null;
let currentResults = [];
let currentDatasetDate = '';
let lastDebug = null;
let originMode = 'coords';
let originResolutionCache = null;
let detectedPostalCode = '';
let lastGeoPosition = null;

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY) || LEGACY_FAVORITES_KEYS.map(k => localStorage.getItem(k)).find(Boolean);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFavorites() {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favoriteIds]));
}

function openAppDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const request = indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) db.createObjectStore(CACHE_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('No se pudo abrir la base de datos del navegador'));
  });
}

async function saveDatasetCache(dataset) {
  try {
    const db = await openAppDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
      tx.objectStore(CACHE_STORE_NAME).put({
        dataset,
        savedAt: new Date().toISOString(),
        manualJson: String(els.manualJsonInput?.value || '')
      }, 'lastDataset');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('No se pudo guardar el dataset en la base del navegador'));
    });
    db.close();
  } catch (error) {
    console.warn('No se pudo guardar la caché del dataset', error);
  }
}

async function loadDatasetCache() {
  try {
    const db = await openAppDb();
    const data = await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
      const req = tx.objectStore(CACHE_STORE_NAME).get('lastDataset');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('No se pudo leer la caché del dataset'));
    });
    db.close();
    return data;
  } catch (error) {
    console.warn('No se pudo leer la caché del dataset', error);
    return null;
  }
}


function saveSettings() {
  const settings = {
    latitude: els.latitudeInput.value,
    longitude: els.longitudeInput.value,
    detectedPostalCode,
    maxDistance: els.maxDistanceInput.value,
    address: els.addressInput.value,
    resultSearch: els.resultSearchInput.value,
    consumption: els.consumptionInput.value,
    tripType: els.tripTypeInput.value,
    fuelType: els.fuelTypeInput.value,
    tankCapacity: els.tankCapacityInput.value,
    limit: els.limitInput.value,
    sortBy: els.sortByInput.value,
    favoriteMode: els.favoriteModeInput.value,
    showOnlyPriced: els.showOnlyPricedInput.checked,
    dataUrl: els.dataUrlInput.value,
    customBrand: els.customBrandInput.value,
    manualJson: els.manualJsonInput?.value || '',
    selectedBrands: [...selectedBrands],
    originMode
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) || LEGACY_SETTINGS_KEYS.map(k => localStorage.getItem(k)).find(Boolean);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return;
    if (s.latitude) els.latitudeInput.value = s.latitude;
    if (s.longitude) els.longitudeInput.value = s.longitude;
    if (typeof s.detectedPostalCode === 'string') detectedPostalCode = s.detectedPostalCode;
    if (s.maxDistance) els.maxDistanceInput.value = s.maxDistance;
    if (s.address) els.addressInput.value = s.address;
    if (typeof s.resultSearch === 'string') els.resultSearchInput.value = s.resultSearch;
    if (s.consumption) els.consumptionInput.value = s.consumption;
    if (s.tripType) els.tripTypeInput.value = s.tripType;
    if (s.fuelType) els.fuelTypeInput.value = s.fuelType;
    if (s.tankCapacity) els.tankCapacityInput.value = s.tankCapacity;
    if (s.limit) els.limitInput.value = s.limit;
    if (s.sortBy) els.sortByInput.value = s.sortBy;
    if (s.dataUrl) els.dataUrlInput.value = s.dataUrl;
    if (typeof s.customBrand === 'string') els.customBrandInput.value = s.customBrand;
    if (typeof s.manualJson === 'string' && els.manualJsonInput) els.manualJsonInput.value = s.manualJson;
    if (s.favoriteMode) els.favoriteModeInput.value = s.favoriteMode;
    els.showOnlyPricedInput.checked = s.showOnlyPriced !== false;
    if (Array.isArray(s.selectedBrands) && s.selectedBrands.length) {
      selectedBrands = new Set(s.selectedBrands.map(normalizeText));
    }
    if (typeof s.originMode === 'string') originMode = s.originMode;
  } catch {}
}

function originModeLabel(mode = originMode) {
  if (mode === 'geo') return 'Ubicación';
  if (mode === 'postal') return 'CP';
  if (mode === 'address') return 'Dirección';
  return 'Coordenadas manuales';
}

function updateOriginModeUI() {
  if (els.originModeBadge) els.originModeBadge.textContent = `Activo: ${originModeLabel()}`;
  const activeMap = { coords: 'coordsBlock', geo: 'coordsBlock', postal: 'addressBlock', address: 'addressBlock' };
  ['coordsBlock', 'addressBlock'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', activeMap[originMode] === id);
  });
  if (els.geoBtn) els.geoBtn.classList.toggle('active', originMode === 'geo');
}

function setOriginMode(mode) {
  originMode = mode;
  updateOriginModeUI();
  saveSettings();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function pick(row, keys) {
  for (const key of keys) {
    if (row?.[key] != null && row[key] !== '') return row[key];
  }
  return '';
}

function parseCoordinate(value) {
  const num = Number(String(value ?? '').replace(',', '.').trim());
  return Number.isFinite(num) ? num : NaN;
}

function parsePrice(value) {
  const num = Number(String(value ?? '').replace(',', '.').trim());
  return Number.isFinite(num) && num > 0 ? num : NaN;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatPrice(value) {
  return Number.isFinite(value) ? value.toFixed(3).replace('.', ',') + ' €/L' : '—';
}

function formatKm(value) {
  return Number.isFinite(value) ? value.toFixed(2).replace('.', ',') + ' km' : '—';
}

function formatLiters(value) {
  return Number.isFinite(value) ? value.toFixed(2).replace('.', ',') + ' L' : '—';
}

function formatCurrency(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value)
    : '—';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fuelLabel() {
  return els.fuelTypeInput.options[els.fuelTypeInput.selectedIndex]?.textContent || 'Combustible';
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function computeTrip(distanceKm, consumptionPer100, pricePerLiter, tripType) {
  const multiplier = tripType === 'roundtrip' ? 2 : 1;
  const km = Number.isFinite(distanceKm) ? distanceKm * multiplier : NaN;
  const liters = Number.isFinite(km) ? (km * consumptionPer100) / 100 : NaN;
  const cost = Number.isFinite(liters) && Number.isFinite(pricePerLiter) ? liters * pricePerLiter : NaN;
  return { km, liters, cost };
}

function getCurrentDayCode() {
  const day = new Date().getDay();
  return ['D', 'L', 'M', 'X', 'J', 'V', 'S'][day] || 'L';
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function rangeMatchesToday(rangeText, dayCode) {
  const normalized = normalizeText(rangeText).replace(/\s+/g, '');
  if (!normalized || normalized.includes('L-D') || normalized.includes('LAD')) return true;
  const parts = normalized.split(',');
  return parts.some(part => {
    if (part.includes('-')) {
      const [start, end] = part.split('-');
      const order = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
      const iStart = order.indexOf(start);
      const iEnd = order.indexOf(end);
      const iDay = order.indexOf(dayCode);
      if (iStart === -1 || iEnd === -1 || iDay === -1) return false;
      if (iStart <= iEnd) return iDay >= iStart && iDay <= iEnd;
      return iDay >= iStart || iDay <= iEnd;
    }
    return part === dayCode;
  });
}

function computeMinutesUntilClose(startMin, endMin, nowMinutes) {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
  if (startMin <= endMin) {
    if (nowMinutes >= startMin && nowMinutes <= endMin) return endMin - nowMinutes;
    return null;
  }
  if (nowMinutes >= startMin) return (24 * 60 - nowMinutes) + endMin;
  if (nowMinutes <= endMin) return endMin - nowMinutes;
  return null;
}

function getScheduleStatus(schedule) {
  const normalized = normalizeText(schedule);
  if (!normalized || normalized === 'NO DISPONIBLE') {
    return { isOpenNow: false, closesSoon: false, minutesToClose: null, state: 'closed', chipText: '🕘 Horario · No disponible' };
  }
  if (normalized.includes('24H')) {
    return { isOpenNow: true, closesSoon: false, minutesToClose: null, state: 'open', chipText: `🕘 Abierto · ${schedule}` };
  }

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const dayCode = getCurrentDayCode();
  const segments = String(schedule).split(/;|\n/).map(s => s.trim()).filter(Boolean);
  let minClose = null;

  for (const segment of segments) {
    const segmentNorm = normalizeText(segment);
    let matchedRange = null;

    const match = segmentNorm.match(/^([LMXJVSD,\-\s]+):\s*(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/);
    if (match) {
      const [, days, start, end] = match;
      if (!rangeMatchesToday(days, dayCode)) continue;
      matchedRange = [start, end];
    } else {
      const plainRange = segmentNorm.match(/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/);
      if (plainRange) matchedRange = [plainRange[1], plainRange[2]];
    }

    if (!matchedRange) continue;
    const startMin = timeToMinutes(matchedRange[0]);
    const endMin = timeToMinutes(matchedRange[1]);
    const minutesUntilClose = computeMinutesUntilClose(startMin, endMin, nowMinutes);
    if (minutesUntilClose === null) continue;
    if (minClose === null || minutesUntilClose < minClose) minClose = minutesUntilClose;
  }

  if (minClose === null) {
    return { isOpenNow: false, closesSoon: false, minutesToClose: null, state: 'closed', chipText: `🕘 Horario · ${schedule}` };
  }

  const closesSoon = minClose <= 30;
  return {
    isOpenNow: true,
    closesSoon,
    minutesToClose: minClose,
    state: closesSoon ? 'soon' : 'open',
    chipText: closesSoon ? `🕘 Cierra pronto · ${schedule}` : `🕘 Abierto · ${schedule}`
  };
}

function isStationOpenNow(schedule) {
  return getScheduleStatus(schedule).isOpenNow;
}

function mapsUrl(lat, lon, label) {
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label || '')}`;
}

function wazeUrl(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '#';
  return `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
}

function appleMapsUrl(lat, lon, label) {
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=d`;
  }
  return `https://maps.apple.com/?q=${encodeURIComponent(label || '')}`;
}

function iconSvg(type) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  if (type === 'google') return `<svg ${common}><path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1 1 18 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
  if (type === 'waze') return `<svg ${common}><path d="M6 15c0 2.5 2.4 4.5 5.4 4.5 4.7 0 8.6-3.8 8.6-8.5 0-3.9-3.1-7-7-7a6.98 6.98 0 0 0-6.9 6"></path><path d="M5 13c-1.7 0-3 1.3-3 3"></path><path d="M8 20h.01"></path><path d="M13 20h.01"></path><path d="M13 11h.01"></path><path d="M17 11h.01"></path></svg>`;
  if (type === 'apple') return `<svg ${common}><path d="M16.5 13.5c0-2 1.5-2.9 1.6-3-.9-1.3-2.3-1.5-2.8-1.5-1.2-.1-2.3.7-2.9.7-.6 0-1.5-.7-2.4-.7-1.3 0-2.4.7-3 1.8-1.3 2.1-.3 5.3.9 7 .6.8 1.3 1.8 2.3 1.7.9 0 1.3-.6 2.4-.6 1.1 0 1.4.6 2.4.6 1 0 1.7-.9 2.3-1.7.6-.9.9-1.8 1-1.9-.1 0-1.8-.7-1.8-2.4Z"></path><path d="M14.5 6.4c.5-.6.8-1.4.7-2.3-.7 0-1.6.5-2.1 1.1-.5.5-.9 1.4-.8 2.2.8.1 1.7-.4 2.2-1Z"></path></svg>`;
  return `<svg ${common}><circle cx="12" cy="12" r="9"></circle></svg>`;
}

function favoriteSvg(active) {
  return active
    ? `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.3l-6.16 3.7 1.64-7.02L2 9.24l7.19-.61L12 2l2.81 6.63 7.19.61-5.48 4.74 1.64 7.02z"></path></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 17.3l-6.16 3.7 1.64-7.02L2 9.24l7.19-.61L12 2l2.81 6.63 7.19.61-5.48 4.74 1.64 7.02z"></path></svg>`;
}

function renderBrandChips() {
  const customBrand = normalizeText(els.customBrandInput.value);
  const brands = [...new Set([...DEFAULT_BRANDS, ...(customBrand ? [customBrand] : [])])];
  els.brandChips.innerHTML = brands.map(brand => {
    const active = selectedBrands.has(brand);
    return `
      <label class="brand-chip ${active ? 'active' : ''}" data-brand="${brand}">
        <input type="checkbox" value="${brand}" ${active ? 'checked' : ''}>
        <span>${brand}</span>
      </label>
    `;
  }).join('');

  els.brandChips.querySelectorAll('input').forEach(input => {
    input.addEventListener('change', (event) => {
      const brand = normalizeText(event.target.value);
      if (event.target.checked) selectedBrands.add(brand);
      else selectedBrands.delete(brand);
      renderBrandChips();
      saveSettings();
      applyCurrentFilters();
    });
  });

  updateActiveBrandsText();
}

function updateActiveBrandsText() {
  const list = [...selectedBrands];
  els.activeBrandsText.textContent = list.length ? list.join(', ') : 'Todas las marcas';
}

function getAddressPostalCode() {
  const match = String(els.addressInput?.value || '').match(/\b(\d{5})\b/);
  return match ? match[1] : '';
}

function currentPostalCodeGuess() {
  return getAddressPostalCode() || detectedPostalCode || '';
}

function usePostalPresetIfKnown() {
  const cp = currentPostalCodeGuess();
  const preset = PRESET_POSTAL_CENTERS[cp];
  if (preset) {
    els.latitudeInput.value = String(preset.lat);
    els.longitudeInput.value = String(preset.lon);
  }
}

async function geocodeQuery(query, kind = 'address') {
  const q = String(query || '').trim();
  if (!q) throw new Error(kind === 'postal' ? 'Introduce un código postal.' : 'Introduce una dirección o municipio.');

  const attempts = [];
  if (kind === 'postal') {
    attempts.push(`${q}, España`);
    attempts.push(`${q}, Madrid, España`);
  } else {
    attempts.push(q);
    if (!/espana|españa/i.test(q)) attempts.push(`${q}, España`);
  }

  for (const attempt of attempts) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('countrycodes', 'es');
    url.searchParams.set('dedupe', '1');
    url.searchParams.set('q', attempt);

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'es'
      }
    });
    if (!response.ok) throw new Error(`Geocodificación HTTP ${response.status}`);
    const data = await response.json();
    if (Array.isArray(data) && data.length) {
      const best = data[0];
      const postcode = best.address?.postcode?.match(/\d{5}/)?.[0] || (kind === 'postal' ? q.match(/\d{5}/)?.[0] || '' : '');
      const shortParts = [best.address?.road, best.address?.house_number, best.address?.suburb, best.address?.city || best.address?.town || best.address?.village || best.address?.municipality, postcode].filter(Boolean);
      return {
        lat: Number(best.lat),
        lon: Number(best.lon),
        postcode,
        label: best.display_name || attempt,
        shortLabel: shortParts.join(', ') || best.display_name || attempt
      };
    }
  }

  throw new Error(kind === 'postal' ? 'No se encontró ese código postal.' : 'No se encontró esa dirección o municipio.');
}

async function geocodeAddress() {
  const rawAddress = String(els.addressInput.value || '').trim();
  const query = rawAddress;
  if (!query) {
    setStatus('Introduce una dirección, municipio o código postal.');
    return;
  }
  const isPostalOnly = /^\d{5}$/.test(query);
  setOriginMode(isPostalOnly ? 'postal' : 'address');
  setStatus(`Buscando ${isPostalOnly ? 'código postal' : 'dirección'} de origen...`);
  try {
    const resolved = await geocodeQuery(query, isPostalOnly ? 'postal' : 'address');
    els.latitudeInput.value = resolved.lat.toFixed(6);
    els.longitudeInput.value = resolved.lon.toFixed(6);
    detectedPostalCode = resolved.postcode || detectedPostalCode || '';
    if (resolved.shortLabel) els.addressInput.value = resolved.shortLabel;
    originResolutionCache = { mode: isPostalOnly ? 'postal' : 'address', sourceValue: query, ...resolved };
    setStatus(`Origen encontrado: ${resolved.shortLabel || resolved.label}`);
    saveSettings();
    if (currentDataset) await applyCurrentFilters();
  } catch (error) {
    console.error(error);
    setStatus('No se pudo geocodificar el origen. ' + error.message);
  }
}

async function maybeGeocodeAddress() {
  const rawAddress = String(els.addressInput.value || '').trim();
  if (rawAddress.length >= 3) {
    await geocodeAddress();
  }
}

async function getBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Este navegador no soporta geolocalización.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        const resolved = {
          lat: Number(position.coords.latitude),
          lon: Number(position.coords.longitude),
          label: 'Ubicación actual'
        };
        els.latitudeInput.value = resolved.lat.toFixed(6);
        els.longitudeInput.value = resolved.lon.toFixed(6);
        lastGeoPosition = resolved;
        resolve(resolved);
      },
      error => reject(new Error(error.message)),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

function hasValidCoordsInput() {
  const lat = Number(els.latitudeInput.value);
  const lon = Number(els.longitudeInput.value);
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function hasPostalInput() {
  return /^\d{5}$/.test(currentPostalCodeGuess()) || /^\d{5}$/.test(String(els.addressInput.value || '').trim());
}

function hasAddressInput() {
  return String(els.addressInput.value || '').trim().length >= 3;
}

async function resolveOrigin() {
  async function tryMode(mode) {
    if (mode === 'coords') {
      const lat = Number(els.latitudeInput.value);
      const lon = Number(els.longitudeInput.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('Las coordenadas manuales no son válidas.');
      return { lat, lon, label: 'Coordenadas manuales', mode: 'coords' };
    }

    if (mode === 'geo') {
      if (lastGeoPosition) return { ...lastGeoPosition, mode: 'geo' };
      const resolved = await getBrowserLocation();
      return { ...resolved, mode: 'geo' };
    }

    if (mode === 'postal') {
      const cp = String(currentPostalCodeGuess() || els.addressInput.value || '').trim();
      if (!cp) throw new Error('Introduce un código postal.');
      if (PRESET_POSTAL_CENTERS[cp]) {
        const preset = PRESET_POSTAL_CENTERS[cp];
        const resolved = { lat: preset.lat, lon: preset.lon, postcode: cp, label: preset.label, mode: 'postal' };
        els.latitudeInput.value = resolved.lat.toFixed(6);
        els.longitudeInput.value = resolved.lon.toFixed(6);
        if (resolved.shortLabel) els.addressInput.value = resolved.shortLabel;
      originResolutionCache = { mode: 'postal', sourceValue: cp, ...resolved };
        return resolved;
      }
      if (originResolutionCache && originResolutionCache.mode === 'postal' && originResolutionCache.sourceValue === cp) {
        els.latitudeInput.value = originResolutionCache.lat.toFixed(6);
        els.longitudeInput.value = originResolutionCache.lon.toFixed(6);
        return { ...originResolutionCache, mode: 'postal' };
      }
      const resolved = await geocodeQuery(cp, 'postal');
      els.latitudeInput.value = resolved.lat.toFixed(6);
      els.longitudeInput.value = resolved.lon.toFixed(6);
      if (resolved.postcode) detectedPostalCode = resolved.postcode;
      if (resolved.shortLabel) els.addressInput.value = resolved.shortLabel;
      originResolutionCache = { mode: 'postal', sourceValue: cp, ...resolved };
      return { ...resolved, mode: 'postal' };
    }

    const query = String(els.addressInput.value || '').trim();
    if (!query) throw new Error('Introduce una dirección, municipio o código postal.');
    if (/^\d{5}$/.test(query)) return tryMode('postal');
    if (originResolutionCache && originResolutionCache.mode === 'address' && originResolutionCache.sourceValue === query) {
      els.latitudeInput.value = originResolutionCache.lat.toFixed(6);
      els.longitudeInput.value = originResolutionCache.lon.toFixed(6);
      return { ...originResolutionCache, mode: 'address' };
    }
    const resolved = await geocodeQuery(query, 'address');
    els.latitudeInput.value = resolved.lat.toFixed(6);
    els.longitudeInput.value = resolved.lon.toFixed(6);
    if (resolved.postcode) detectedPostalCode = resolved.postcode;
    if (resolved.shortLabel) els.addressInput.value = resolved.shortLabel;
    originResolutionCache = { mode: 'address', sourceValue: query, ...resolved };
    return { ...resolved, mode: 'address' };
  }

  const preferred = originMode;
  const fallbackOrder = [preferred];
  if (preferred !== 'coords' && hasValidCoordsInput()) fallbackOrder.push('coords');
  if (preferred !== 'address' && hasAddressInput()) fallbackOrder.push('address');
  if (preferred !== 'postal' && hasPostalInput()) fallbackOrder.push('postal');
  if (preferred !== 'geo' && lastGeoPosition) fallbackOrder.push('geo');

  for (const mode of ['coords', 'address', 'postal', 'geo']) {
    if (!fallbackOrder.includes(mode)) fallbackOrder.push(mode);
  }

  let lastError = null;
  for (const mode of fallbackOrder) {
    try {
      const resolved = await tryMode(mode);
      if (mode !== originMode) {
        originMode = mode;
        updateOriginModeUI();
      }
      return resolved;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No se pudo resolver el origen.');
}

async function applyOrigin() {
  try {
    setStatus(`Aplicando origen por ${originModeLabel().toLowerCase()}...`);
    const resolved = await resolveOrigin();
    setStatus(`Origen activo: ${originModeLabel(resolved.mode || originMode)} · ${resolved.label || 'listo'}`);
    saveSettings();
    if (currentDataset) await applyCurrentFilters();
  } catch (error) {
    console.error(error);
    setStatus('No se pudo aplicar el origen. ' + error.message);
  }
}

async function getDatasetFromDirectUrl() {
  const inputUrl = els.dataUrlInput.value.trim() || DEFAULT_DATA_URL;
  const url = new URL(inputUrl, window.location.href);
  url.searchParams.set('v', String(Date.now()));

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });

  if (!response.ok) throw new Error(`No se pudo leer la URL ${inputUrl}. HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!text.trim()) throw new Error('La respuesta de la URL está vacía.');

  try {
    return JSON.parse(text);
  } catch {
    const hint = text.slice(0, 160).replace(/\s+/g, ' ');
    throw new Error(`La URL respondió con content-type "${contentType || 'desconocido'}" y no devolvió JSON parseable. Inicio recibido: ${hint}`);
  }
}

function parseDatasetText(text) {
  const parsed = JSON.parse(text);
  if (!parsed || !Array.isArray(parsed.ListaEESSPrecio)) {
    throw new Error('El JSON no contiene ListaEESSPrecio utilizable.');
  }
  return parsed;
}

function getDatasetFromManualJson() {
  const text = String(els.manualJsonInput?.value || '').trim();
  if (!text) throw new Error('No hay JSON pegado.');
  const dataset = parseDatasetText(text);
  dataset.metadata = {
    ...(dataset.metadata || {}),
    source: 'JSON pegado manualmente',
    fetched_at_utc: new Date().toLocaleString('es-ES'),
    row_count: Array.isArray(dataset.ListaEESSPrecio) ? dataset.ListaEESSPrecio.length : 0
  };
  return dataset;
}

function stationMatchesBrand(brand) {
  if (!selectedBrands.size) return true;
  const normalized = normalizeText(brand);
  return [...selectedBrands].some(selected => normalized.includes(selected));
}

function transformDataset(dataset) {
  const debug = { totalRows: 0, brandMatches: 0, withCoords: 0, withinDistance: 0, withPrice: 0 };
  const fuelKey = els.fuelTypeInput.value;
  const lat0 = Number(els.latitudeInput.value);
  const lon0 = Number(els.longitudeInput.value);
  const maxDistance = Number(els.maxDistanceInput.value);
  const consumption = Number(els.consumptionInput.value);
  const tripType = els.tripTypeInput.value;
  const tankCapacity = Number(els.tankCapacityInput.value);
  const limit = Number(els.limitInput.value) || 20;
  const sortBy = els.sortByInput.value;
  const favoriteMode = els.favoriteModeInput.value;
  const showOnlyPriced = els.showOnlyPricedInput.checked;
  const searchText = normalizeText(els.resultSearchInput.value);

  if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) throw new Error('Latitud o longitud no válidas.');
  if (!Number.isFinite(consumption) || consumption <= 0) throw new Error('El consumo medio debe ser mayor que 0.');
  if (!Number.isFinite(tankCapacity) || tankCapacity <= 0) throw new Error('La capacidad del depósito debe ser mayor que 0.');

  currentDatasetDate = dataset?.Fecha || dataset?.metadata?.dataset_date || dataset?.metadata?.fetched_at_utc || '';
  const rows = Array.isArray(dataset?.ListaEESSPrecio) ? dataset.ListaEESSPrecio : [];
  debug.totalRows = rows.length;
  if (!rows.length) throw new Error('El dataset no contiene ListaEESSPrecio utilizable.');

  const brandMatchedRows = rows.filter(row => stationMatchesBrand(pick(row, ['Rótulo', 'Rotulo', 'Rótulo '])));
  debug.brandMatches = brandMatchedRows.length;

  const mapped = brandMatchedRows.map(row => {
    const brand = pick(row, ['Rótulo', 'Rotulo']) || '—';
    const address = pick(row, ['Dirección', 'Direccion']);
    const postalCode = pick(row, ['C.P.', 'CP', 'CodigoPostal']);
    const municipality = pick(row, ['Municipio', 'Localidad']);
    const locality = pick(row, ['Localidad']);
    const lat = parseCoordinate(pick(row, ['Latitud']));
    const lon = parseCoordinate(pick(row, ['Longitud_x0020__x0028_WGS84_x0029_', 'Longitud (WGS84)', 'Longitud_x0020__x0028WGS84_x0029_', 'Longitud']));
    const pumpPrice = parsePrice(pick(row, [fuelKey, 'Precio_x0020_Gasoleo_x0020_A', 'Precio Gasoleo A']));
    const distanceKm = Number.isFinite(lat) && Number.isFinite(lon) ? haversineKm(lat0, lon0, lat, lon) : NaN;
    const trip = computeTrip(distanceKm, consumption, pumpPrice, tripType);
    const fullRefillCost = Number.isFinite(pumpPrice) ? pumpPrice * tankCapacity : NaN;
    const visitTotalCost = Number.isFinite(fullRefillCost) && Number.isFinite(trip.cost) ? fullRefillCost + trip.cost : NaN;
    const label = `${address}, ${postalCode} ${municipality}`;
    const id = pick(row, ['IDEESS']) || `${brand}-${address}-${postalCode}`;

    const schedule = pick(row, ['Horario']) || 'No disponible';
    const scheduleStatus = getScheduleStatus(schedule);

    return {
      id,
      brand,
      address,
      municipality,
      locality,
      postalCode,
      schedule,
      scheduleStatus,
      lat,
      lon,
      pumpPrice,
      distanceKm,
      travelKm: trip.km,
      tripLiters: trip.liters,
      tripCost: trip.cost,
      fullRefillCost,
      visitTotalCost,
      isFavorite: favoriteIds.has(id),
      isOpenNow: scheduleStatus.isOpenNow,
      closesSoon: scheduleStatus.closesSoon,
      googleUrl: mapsUrl(lat, lon, label),
      wazeUrl: wazeUrl(lat, lon),
      appleUrl: appleMapsUrl(lat, lon, label)
    };
  });

  debug.withCoords = mapped.filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lon)).length;
  debug.withPrice = mapped.filter(item => Number.isFinite(item.pumpPrice)).length;
  debug.withinDistance = mapped.filter(item => Number.isFinite(item.distanceKm) && item.distanceKm <= maxDistance).length;

  const transformed = mapped
    .filter(item => Number.isFinite(item.distanceKm) && item.distanceKm <= maxDistance)
    .filter(item => !showOnlyPriced || Number.isFinite(item.pumpPrice))
    .filter(item => favoriteMode !== 'only' || item.isFavorite)
    .filter(item => {
      if (!searchText) return true;
      const haystack = normalizeText([item.brand, item.address, item.municipality, item.locality, item.postalCode].join(' '));
      return haystack.includes(searchText);
    });

  transformed.sort((a, b) => {
    const favoriteBoost = favoriteMode === 'blend' ? Number(b.isFavorite) - Number(a.isFavorite) : 0;
    if (favoriteBoost) return favoriteBoost;
    if (sortBy === 'price') return (a.pumpPrice - b.pumpPrice) || (a.distanceKm - b.distanceKm);
    if (sortBy === 'tripCost') return (a.tripCost - b.tripCost) || (a.pumpPrice - b.pumpPrice);
    if (sortBy === 'distance') return (a.distanceKm - b.distanceKm) || (a.pumpPrice - b.pumpPrice);
    if (sortBy === 'fullRefill') return (a.fullRefillCost - b.fullRefillCost) || (a.pumpPrice - b.pumpPrice);
    return (a.visitTotalCost - b.visitTotalCost) || (a.pumpPrice - b.pumpPrice) || (a.distanceKm - b.distanceKm);
  });

  lastDebug = debug;
  return transformed.slice(0, limit);
}

function renderSourceBox(dataset) {
  const metadata = dataset?.metadata || {};
  els.sourceText.textContent = metadata.source || els.dataUrlInput.value.trim() || DEFAULT_DATA_URL;
  els.fetchedAtText.textContent = metadata.fetched_at_utc || new Date().toLocaleString('es-ES');
  els.rowCountText.textContent = String(metadata.row_count ?? (Array.isArray(dataset?.ListaEESSPrecio) ? dataset.ListaEESSPrecio.length : '—'));
  updateActiveBrandsText();
}

function renderSummary(results) {
  els.stationCount.textContent = String(results.length);
  els.favoriteCount.textContent = String(results.filter(item => item.isFavorite).length);
  els.datasetDate.textContent = currentDatasetDate || 'sin fecha';
  const minPump = results.length ? Math.min(...results.map(item => item.pumpPrice).filter(Number.isFinite)) : NaN;
  els.minPumpPrice.textContent = formatPrice(minPump);

  if (!results.length) {
    els.bestCard.innerHTML = `
      <div class="best-label">MEJOR OPCIÓN</div>
      <div class="best-empty">
        <div class="best-title">No hay resultados</div>
        <div class="best-body">Prueba con más radio, menos filtros, otra dirección o cambia el modo de favoritos.</div>
      </div>
    `;
    return;
  }

  const best = results[0];
  els.bestCard.innerHTML = `
    <div class="best-label">MEJOR OPCIÓN</div>
    <article class="best-compact-card ${best.isFavorite ? 'favorite' : ''}">
      <div class="best-head-grid">
        <div>
          <div class="best-title-row">
            <span class="station-rank">#1</span>
            <div class="best-title">${escapeHtml(best.brand)}</div>
          </div>
          <div class="station-address">${escapeHtml(best.address)} · ${escapeHtml(best.postalCode)} ${escapeHtml(best.municipality)}</div>
        </div>
        <div class="best-price-side">
          <div class="summary-price-compact"><span>${escapeHtml(fuelLabel())}</span><strong>${formatPrice(best.pumpPrice)}</strong></div>
          <div class="summary-total-compact"><span>Total visita</span><strong>${formatCurrency(best.visitTotalCost)}</strong></div>
        </div>
      </div>
      <div class="station-summary-chips">
        <span class="mini-chip">📍 ${formatKm(best.distanceKm)}</span>
        <span class="mini-chip">🚗 ${formatCurrency(best.tripCost)}</span>
        <span class="mini-chip">⛽ ${formatCurrency(best.fullRefillCost)}</span>
        <span class="mini-chip ${best.closesSoon ? 'soon-chip' : (best.isOpenNow ? 'open-chip' : 'closed-chip')}">${escapeHtml(best.scheduleStatus?.chipText || `🕘 Horario · ${best.schedule}`)}</span>
      </div>
      <div class="best-metrics">
        <div class="metric-card"><span>Kilómetros trayecto</span><strong>${formatKm(best.travelKm)}</strong></div>
        <div class="metric-card"><span>Litros trayecto</span><strong>${formatLiters(best.tripLiters)}</strong></div>
        <div class="metric-card"><span>Coste trayecto</span><strong>${formatCurrency(best.tripCost)}</strong></div>
        <div class="metric-card"><span>Repostaje completo</span><strong>${formatCurrency(best.fullRefillCost)}</strong></div>
      </div>
      <div class="station-actions-row best-actions">
        <a class="nav-btn" href="${best.googleUrl}" target="_blank" rel="noopener noreferrer">${iconSvg('google')}<span>Maps</span></a>
        <a class="nav-btn" href="${best.wazeUrl}" target="_blank" rel="noopener noreferrer">${iconSvg('waze')}<span>Waze</span></a>
        <a class="nav-btn" href="${best.appleUrl}" target="_blank" rel="noopener noreferrer">${iconSvg('apple')}<span>Apple</span></a>
        <button class="favorite-btn ${best.isFavorite ? 'active' : ''}" data-favorite-id-best="${escapeHtml(best.id)}">${favoriteSvg(best.isFavorite)} <span>${best.isFavorite ? 'Favorito' : 'Guardar'}</span></button>
      </div>
    </article>
  `;

  const favoriteBtn = els.bestCard.querySelector('[data-favorite-id-best]');
  if (favoriteBtn) {
    favoriteBtn.addEventListener('click', event => {
      event.preventDefault();
      toggleFavorite(event.currentTarget.dataset.favoriteIdBest);
    });
  }
}

function renderCards(results) {
  if (!results.length) {
    els.cardsContainer.className = 'cards-container empty-state';
    els.cardsContainer.textContent = 'No hay estaciones que cumplan el filtro actual.';
    return;
  }

  els.cardsContainer.className = 'cards-container';
  els.cardsContainer.innerHTML = results.map((item, index) => `
    <details class="station-card ${item.isFavorite ? 'favorite' : ''}">
      <summary>
        <div class="station-summary-head">
          <div class="station-summary-main">
            <div class="station-title-row">
              <span class="station-rank">#${index + 1}</span>
              <div class="station-brand">${escapeHtml(item.brand)}</div>
            </div>
            <div class="station-address">${escapeHtml(item.address)} · ${escapeHtml(item.postalCode)} ${escapeHtml(item.municipality)}</div>
          </div>
          <div class="station-summary-side">
            <div class="summary-price-compact"><span>${escapeHtml(fuelLabel())}</span><strong>${formatPrice(item.pumpPrice)}</strong></div>
            <div class="summary-total-compact"><span>Total visita</span><strong>${formatCurrency(item.visitTotalCost)}</strong></div>
          </div>
        </div>
        <div class="station-summary-chips">
          <span class="mini-chip">📍 ${formatKm(item.distanceKm)}</span>
          <span class="mini-chip">🚗 ${formatCurrency(item.tripCost)}</span>
          <span class="mini-chip">⛽ ${formatCurrency(item.fullRefillCost)}</span>
          <span class="mini-chip ${item.closesSoon ? 'soon-chip' : (item.isOpenNow ? 'open-chip' : 'closed-chip')}">${escapeHtml(item.scheduleStatus?.chipText || `🕘 Horario · ${item.schedule}`)}</span>
        </div>
        <div class="station-expand-hint">Toca para ver detalle y navegación</div>
      </summary>
      <div class="station-details-body">
        <div class="station-details-grid">
          <div class="metric-card"><span>Kilómetros trayecto</span><strong>${formatKm(item.travelKm)}</strong></div>
          <div class="metric-card"><span>Litros trayecto</span><strong>${formatLiters(item.tripLiters)}</strong></div>
          <div class="metric-card"><span>Coste trayecto</span><strong>${formatCurrency(item.tripCost)}</strong></div>
          <div class="metric-card"><span>Repostaje completo</span><strong>${formatCurrency(item.fullRefillCost)}</strong></div>
          <div class="metric-card"><span>Coste total visita</span><strong>${formatCurrency(item.visitTotalCost)}</strong></div>
          <div class="metric-card"><span>Horario</span><strong>${escapeHtml(item.schedule)}</strong></div>
        </div>
        <div class="station-actions-row">
          <a class="nav-btn" href="${item.googleUrl}" target="_blank" rel="noopener noreferrer">${iconSvg('google')}<span>Maps</span></a>
          <a class="nav-btn" href="${item.wazeUrl}" target="_blank" rel="noopener noreferrer">${iconSvg('waze')}<span>Waze</span></a>
          <a class="nav-btn" href="${item.appleUrl}" target="_blank" rel="noopener noreferrer">${iconSvg('apple')}<span>Apple</span></a>
          <button class="favorite-btn ${item.isFavorite ? 'active' : ''}" data-favorite-id="${escapeHtml(item.id)}">${favoriteSvg(item.isFavorite)} <span>${item.isFavorite ? 'Favorito' : 'Guardar'}</span></button>
        </div>
      </div>
    </details>
  `).join('');

  els.cardsContainer.querySelectorAll('[data-favorite-id]').forEach(btn => {
    btn.addEventListener('click', event => {
      event.preventDefault();
      toggleFavorite(event.currentTarget.dataset.favoriteId);
    });
  });
}

function toggleFavorite(id) {
  if (favoriteIds.has(id)) favoriteIds.delete(id);
  else favoriteIds.add(id);
  saveFavorites();
  applyCurrentFilters();
}

function exportCsv() {
  if (!currentResults.length) {
    setStatus('No hay resultados que exportar.');
    return;
  }
  const rows = [[
    'rank','favorite','brand','address','postal_code','municipality','fuel','pump_price_eur_l','distance_km',
    'travel_km','trip_liters','trip_cost_eur','full_refill_cost_eur','visit_total_cost_eur','schedule','google_url','waze_url','apple_url'
  ]];
  currentResults.forEach((item, index) => {
    rows.push([
      index + 1,
      item.isFavorite ? 'yes' : 'no',
      item.brand,
      item.address,
      item.postalCode,
      item.municipality,
      fuelLabel(),
      Number.isFinite(item.pumpPrice) ? item.pumpPrice.toFixed(3) : '',
      Number.isFinite(item.distanceKm) ? item.distanceKm.toFixed(3) : '',
      Number.isFinite(item.travelKm) ? item.travelKm.toFixed(3) : '',
      Number.isFinite(item.tripLiters) ? item.tripLiters.toFixed(3) : '',
      Number.isFinite(item.tripCost) ? item.tripCost.toFixed(2) : '',
      Number.isFinite(item.fullRefillCost) ? item.fullRefillCost.toFixed(2) : '',
      Number.isFinite(item.visitTotalCost) ? item.visitTotalCost.toFixed(2) : '',
      item.schedule,
      item.googleUrl,
      item.wazeUrl,
      item.appleUrl
    ]);
  });

  const csv = rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fuelmap-v3_5-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  setStatus('CSV exportado.');
}

function renderSourceAndResults(dataset, results) {
  renderSourceBox(dataset);
  renderSummary(results);
  renderCards(results);
}

async function applyCurrentFilters() {
  if (!currentDataset) return;
  try {
    await resolveOrigin();
    const results = transformDataset(currentDataset);
    currentResults = results;
    renderSourceAndResults(currentDataset, results);
    const debugText = lastDebug ? ` · filas: ${lastDebug.totalRows}, marca: ${lastDebug.brandMatches}, coords: ${lastDebug.withCoords}, dentro radio: ${lastDebug.withinDistance}, precio: ${lastDebug.withPrice}` : '';
    setStatus(`Filtros aplicados. ${results.length} estaciones visibles.${debugText}`);
    saveSettings();
  } catch (error) {
    console.error(error);
    setStatus('No se pudieron aplicar los filtros.\n' + error.message);
  }
}

async function refreshStations() {
  setStatus('Leyendo el endpoint o la fuente configurada...');
  try {
    await resolveOrigin();
    const dataset = await getDatasetFromDirectUrl();
    currentDataset = dataset;
    await saveDatasetCache(dataset);
    const results = transformDataset(dataset);
    currentResults = results;
    renderSourceAndResults(dataset, results);
    const debugText = lastDebug ? ` · filas: ${lastDebug.totalRows}, marca: ${lastDebug.brandMatches}, coords: ${lastDebug.withCoords}, dentro radio: ${lastDebug.withinDistance}, precio: ${lastDebug.withPrice}` : '';
    setStatus(`Lectura directa completada. ${results.length} estaciones en pantalla.${debugText}`);
    saveSettings();
  } catch (error) {
    console.error(error);
    currentDataset = null;
    currentResults = [];
    renderSummary([]);
    renderCards([]);
    setStatus('La lectura directa ha fallado.\n' + error.message + '\n\nEsto suele deberse a CORS o a que la URL devuelve algo distinto de JSON.');
  }
}

async function useMyLocation() {
  try {
    setOriginMode('geo');
    setStatus('Solicitando tu ubicación...');
    await getBrowserLocation();
    detectedPostalCode = '';
    setStatus('Ubicación actual cargada correctamente.');
    saveSettings();
    if (currentDataset) await applyCurrentFilters();
  } catch (error) {
    setStatus('No se pudo obtener la ubicación: ' + error.message);
  }
}

async function processManualJson() {
  try {
    const dataset = getDatasetFromManualJson();
    currentDataset = dataset;
    await saveDatasetCache(dataset);
    const results = transformDataset(dataset);
    currentResults = results;
    renderSourceAndResults(dataset, results);
    setStatus(`JSON manual procesado. ${results.length} estaciones en pantalla.`);
    saveSettings();
  } catch (error) {
    console.error(error);
    setStatus('No se pudo procesar el JSON pegado. ' + error.message);
  }
}

function clearManualJson() {
  if (els.manualJsonInput) els.manualJsonInput.value = '';
  saveSettings();
}

function loadJsonFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (els.manualJsonInput) els.manualJsonInput.value = String(reader.result || '');
    processManualJson();
    event.target.value = '';
  };
  reader.onerror = () => {
    setStatus('No se pudo leer el archivo JSON.');
    event.target.value = '';
  };
  reader.readAsText(file);
}

function clearOrigin() {
  els.addressInput.value = '';
  detectedPostalCode = '';
  originResolutionCache = null;
  saveSettings();
  if (currentDataset) applyCurrentFilters();
  else setStatus('Origen limpiado. Puedes usar coordenadas, ubicación o dirección/CP.');
}

function restoreDefaultSource() {
  els.dataUrlInput.value = DEFAULT_DATA_URL;
  saveSettings();
  setStatus('Se ha restaurado la fuente oficial del Ministerio en la URL de origen de datos.');
}

function attachFormAutoApply() {
  [
    els.latitudeInput, els.longitudeInput, els.maxDistanceInput,
    els.consumptionInput, els.tripTypeInput, els.fuelTypeInput, els.tankCapacityInput,
    els.limitInput, els.sortByInput, els.favoriteModeInput, els.showOnlyPricedInput,
    els.dataUrlInput, els.resultSearchInput
  ].forEach(el => {
    el.addEventListener('change', () => {
      if (el === els.latitudeInput || el === els.longitudeInput) {
        detectedPostalCode = '';
        originResolutionCache = null;
        setOriginMode('coords');
      }
      saveSettings();
      applyCurrentFilters();
    });
    el.addEventListener('focus', () => {
      if (el === els.latitudeInput || el === els.longitudeInput) setOriginMode('coords');
    });
  });


  [els.addressInput, els.customBrandInput, els.resultSearchInput].forEach(el => {
    el.addEventListener('input', () => {
      if (el === els.addressInput) {
        const raw = String(els.addressInput.value || '').trim();
        detectedPostalCode = '';
        originResolutionCache = null;
        setOriginMode(/^\d{5}$/.test(raw) ? 'postal' : 'address');
      }
      if (el === els.customBrandInput) renderBrandChips();
      saveSettings();
    });
  });

  els.addressInput.addEventListener('focus', () => setOriginMode('address'));
  els.addressInput.addEventListener('change', maybeGeocodeAddress);
  els.addressInput.addEventListener('blur', maybeGeocodeAddress);
  els.addressInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      geocodeAddress();
    }
  });
}

async function restoreCachedDatasetIfAvailable() {
  const cached = await loadDatasetCache();
  if (!cached?.dataset) return false;
  currentDataset = cached.dataset;
  if (els.manualJsonInput && !els.manualJsonInput.value && cached.manualJson) els.manualJsonInput.value = cached.manualJson;
  try {
    await applyCurrentFilters();
    setStatus('Se ha restaurado el último dataset guardado en el navegador.');
    return true;
  } catch (error) {
    console.warn('No se pudo restaurar el dataset cacheado', error);
    return false;
  }
}

function clearFavorites() {
  favoriteIds = new Set();
  saveFavorites();
  applyCurrentFilters();
}

async function init() {
  loadSettings();
  usePostalPresetIfKnown();
  updateOriginModeUI();
  renderBrandChips();
  attachFormAutoApply();

  els.geoBtn.addEventListener('click', useMyLocation);
  els.loadBtn.addEventListener('click', refreshStations);
  els.clearOriginBtn.addEventListener('click', clearOrigin);
  els.restoreMineturBtn.addEventListener('click', restoreDefaultSource);
  els.refreshFiltersBtn.addEventListener('click', applyCurrentFilters);
  els.exportBtn.addEventListener('click', exportCsv);
  els.clearFavoritesBtn.addEventListener('click', clearFavorites);
  els.processJsonBtn.addEventListener('click', processManualJson);
  els.clearJsonBtn.addEventListener('click', clearManualJson);
  els.jsonFileInput.addEventListener('change', loadJsonFile);
  els.manualJsonInput.addEventListener('input', saveSettings);

  els.selectAllBrandsBtn.addEventListener('click', () => {
    const custom = normalizeText(els.customBrandInput.value);
    selectedBrands = new Set([...DEFAULT_BRANDS, ...(custom ? [custom] : [])].map(normalizeText));
    renderBrandChips();
    saveSettings();
    applyCurrentFilters();
  });

  els.clearBrandsBtn.addEventListener('click', () => {
    selectedBrands = new Set();
    renderBrandChips();
    saveSettings();
    applyCurrentFilters();
  });

  els.recommendedBrandsBtn.addEventListener('click', () => {
    selectedBrands = new Set(['REPSOL', 'CEPSA', 'BP', 'SHELL']);
    renderBrandChips();
    saveSettings();
    applyCurrentFilters();
  });

  els.helpBtn.addEventListener('click', () => els.helpDialog.showModal());
  els.closeHelpBtn.addEventListener('click', () => els.helpDialog.close());
  els.helpDialog.addEventListener('click', (event) => {
    const rect = els.helpDialog.getBoundingClientRect();
    const inside = rect.top <= event.clientY && event.clientY <= rect.bottom && rect.left <= event.clientX && event.clientX <= rect.right;
    if (!inside) els.helpDialog.close();
  });

  const restored = await restoreCachedDatasetIfAvailable();
  if (!restored) setStatus('Listo para consultar. Usa el bloque Origen, la fuente oficial del Ministerio o pega tu propio JSON si lo necesitas.');
}

init();
