const STORAGE_KEY = "gasrank-form-v1";
const MAX_RESULTS = 20;
const DEFAULT_FORM = {
  fuelType: "regular",
  efficiency: "12",
  liters: "20",
  priceType: "cash",
  radiusKm: "5",
  includeTimeCost: "on",
  hourlyWage: "1000",
  detailMode: "simple",
};

const FUEL_LABELS = {
  regular: "レギュラー",
  premium: "ハイオク",
  diesel: "軽油",
};

const PRICE_TYPE_LABELS = {
  cash: "現金",
  member: "会員",
  appMember: "アプリ会員",
};

const BASE_PRICES = {
  regular: 176,
  premium: 187,
  diesel: 154,
};

const BRAND_PRICE_OFFSETS = {
  eneos: 0,
  idemitsu: -1,
  apollostation: -1,
  cosmo: -2,
  shell: 1,
  ja: -3,
  esso: 1,
};

const PRICE_TYPE_DISCOUNTS = {
  cash: 0,
  member: 2,
  appMember: 4,
};

const overpassEndpoints = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const OVERPASS_TIMEOUT_MS = 5500;
const PRICE_API_BASE = getPriceApiBase();

const state = {
  loading: false,
  loadingMessage: "",
  errorMessage: "",
  location: null,
  locationLabel: "未取得",
  results: [],
  lastSearch: null,
  sort: "total",
  dataSource: "idle",
  activeMapStationId: null,
  isSearchPanelCollapsed: false,
  isMapExpanded: true,
  priceCoverage: {
    actual: 0,
    market: 0,
    estimated: 0,
  },
};

const elements = {
  searchPanel: document.querySelector("#searchPanel"),
  searchForm: document.querySelector("#searchForm"),
  toggleSearchPanelButton: document.querySelector("#toggleSearchPanelButton"),
  searchPanelSummary: document.querySelector("#searchPanelSummary"),
  locateButton: document.querySelector("#locateButton"),
  searchButton: document.querySelector("#searchButton"),
  validationMessage: document.querySelector("#validationMessage"),
  locationText: document.querySelector("#locationText"),
  resultsList: document.querySelector("#resultsList"),
  resultsBanner: document.querySelector("#resultsBanner"),
  resultMapPanel: document.querySelector("#resultMapPanel"),
  searchSummary: document.querySelector("#searchSummary"),
  sortTabs: document.querySelector("#sortTabs"),
  stationDialog: document.querySelector("#stationDialog"),
  dialogContent: document.querySelector("#dialogContent"),
};

init();

function init() {
  state.isMapExpanded = !isMobileViewport();
  hydrateForm();
  bindEvents();
  syncWageInputState();
  renderSearchPanel();
}

function bindEvents() {
  elements.locateButton.addEventListener("click", handleLocateClick);
  elements.toggleSearchPanelButton.addEventListener("click", toggleSearchPanel);
  elements.searchForm.addEventListener("submit", handleSearchSubmit);
  elements.searchForm.addEventListener("change", () => {
    persistForm();
    syncWageInputState();
  });
  elements.searchForm.addEventListener("input", persistForm);
  elements.sortTabs.addEventListener("click", (event) => {
    const target = event.target.closest("[data-sort]");
    if (!target || state.loading) {
      return;
    }

    state.sort = target.dataset.sort;
    renderSortTabs();
    renderResults();
  });
  elements.resultsList.addEventListener("click", handleResultCardClick);
  window.addEventListener("resize", handleViewportChange);
}

function hydrateForm() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }

    const saved = JSON.parse(raw);
    Object.entries({ ...DEFAULT_FORM, ...saved }).forEach(([name, value]) => {
      const field = elements.searchForm.elements.namedItem(name);
      if (!field) {
        return;
      }

      if (typeof RadioNodeList !== "undefined" && field instanceof RadioNodeList) {
        const input = [...field].find((option) => option.value === String(value));
        if (input) {
          input.checked = true;
        }
        return;
      }

      field.value = String(value);
    });
  } catch (error) {
    console.warn("failed to hydrate form", error);
  }
}

function persistForm() {
  try {
    const formValues = readForm();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(formValues));
  } catch (error) {
    console.warn("failed to persist form", error);
  }
}

function readForm() {
  const formData = new FormData(elements.searchForm);
  return {
    fuelType: formData.get("fuelType") || DEFAULT_FORM.fuelType,
    efficiency: formData.get("efficiency") || DEFAULT_FORM.efficiency,
    liters: formData.get("liters") || DEFAULT_FORM.liters,
    priceType: formData.get("priceType") || DEFAULT_FORM.priceType,
    radiusKm: formData.get("radiusKm") || DEFAULT_FORM.radiusKm,
    includeTimeCost: formData.get("includeTimeCost") || DEFAULT_FORM.includeTimeCost,
    hourlyWage: formData.get("hourlyWage") || DEFAULT_FORM.hourlyWage,
    detailMode: formData.get("detailMode") || DEFAULT_FORM.detailMode,
  };
}

function syncWageInputState() {
  const wageInput = elements.searchForm.elements.namedItem("hourlyWage");
  const includeTimeCost = readForm().includeTimeCost === "on";
  wageInput.disabled = !includeTimeCost;
  wageInput.style.opacity = includeTimeCost ? "1" : "0.5";
}

async function handleLocateClick() {
  elements.validationMessage.textContent = "";
  try {
    setLoading(true, "現在地を取得しています…");
    const location = await getCurrentLocation();
    setLocation(location);
  } catch (error) {
    elements.validationMessage.textContent = normalizeLocationError(error);
  } finally {
    setLoading(false);
  }
}

async function handleSearchSubmit(event) {
  event.preventDefault();
  elements.validationMessage.textContent = "";
  const formValues = readForm();
  const validationMessage = validateForm(formValues);

  if (validationMessage) {
    elements.validationMessage.textContent = validationMessage;
    return;
  }

  try {
    setLoading(true, "現在地を確認しています…");
    const location = state.location || (await getCurrentLocation());
    setLocation(location);

    setLoading(true, "近隣のガソリンスタンドを検索しています…");
    const [nearbyStations, municipalityPriceData] = await Promise.all([
      fetchNearbyStations(location, Number(formValues.radiusKm)),
      fetchMunicipalityPriceData(location, formValues.fuelType),
    ]);
    const sourceStations = nearbyStations.length > 0 ? nearbyStations : buildFallbackStations(location);
    const pricedStations = attachMunicipalityPrices(sourceStations, municipalityPriceData, formValues.fuelType);

    setLoading(true, "距離と所要時間を計算しています…");
    const routedStations = await enrichStationsWithRouteMetrics(location, pricedStations);

    setLoading(true, "実質総コストを計算しています…");
    const ranked = buildRankedStations(routedStations, formValues);

    state.lastSearch = {
      ...normalizeFormValues(formValues),
      location,
    };
    state.results = ranked;
    state.activeMapStationId = ranked[0]?.id || null;
    if (isMobileViewport()) {
      state.isSearchPanelCollapsed = true;
      state.isMapExpanded = false;
    }
    state.errorMessage = "";
  } catch (error) {
    console.error(error);
    state.results = [];
    state.errorMessage = "検索に失敗しました。通信状況を確認して再度お試しください。";
  } finally {
    setLoading(false);
    renderSortTabs();
    renderResults();
  }
}

function setLocation(location) {
  state.location = location;
  state.locationLabel = `緯度 ${location.lat.toFixed(5)} / 経度 ${location.lng.toFixed(5)}`;
  elements.locationText.textContent = state.locationLabel;
}

function setLoading(loading, message = "") {
  state.loading = loading;
  state.loadingMessage = message;
  elements.searchButton.disabled = loading;
  elements.locateButton.disabled = loading;
  elements.toggleSearchPanelButton.disabled = loading;
  elements.searchButton.textContent = loading ? "検索中…" : "実質最安を検索";
  renderSearchPanel();
  renderResults();
}

function handleViewportChange() {
  if (!isMobileViewport()) {
    state.isSearchPanelCollapsed = false;
    state.isMapExpanded = true;
  } else if (!state.results.length) {
    state.isSearchPanelCollapsed = false;
    state.isMapExpanded = false;
  }

  renderSearchPanel();
  renderResults();
}

function toggleSearchPanel() {
  state.isSearchPanelCollapsed = !state.isSearchPanelCollapsed;
  renderSearchPanel();
}

function renderSearchPanel() {
  const isCollapsed = isMobileViewport() && state.isSearchPanelCollapsed && !!state.lastSearch;
  elements.searchPanel.classList.toggle("is-collapsed", isCollapsed);
  elements.toggleSearchPanelButton.textContent = isCollapsed ? "条件を開く" : "条件をたたむ";

  if (!state.lastSearch) {
    elements.searchPanelSummary.innerHTML = "";
    return;
  }

  elements.searchPanelSummary.innerHTML = `
    <p class="mobile-summary-title">Quick Setup</p>
    <p class="mobile-summary-text">${escapeHtml(buildMobileSearchSummary(state.lastSearch))}</p>
  `;
}

function validateForm(formValues) {
  const efficiency = Number(formValues.efficiency);
  const liters = Number(formValues.liters);
  const hourlyWage = Number(formValues.hourlyWage || 0);

  if (!Number.isFinite(efficiency) || efficiency <= 0) {
    return "燃費を入力してください";
  }

  if (!Number.isFinite(liters) || liters <= 0) {
    return "給油量を入力してください";
  }

  if (formValues.includeTimeCost === "on" && (!Number.isFinite(hourlyWage) || hourlyWage < 0)) {
    return "時給単価は 0 円以上で入力してください";
  }

  return "";
}

function normalizeFormValues(formValues) {
  return {
    fuelType: formValues.fuelType,
    efficiency: Number(formValues.efficiency),
    liters: Number(formValues.liters),
    priceType: formValues.priceType,
    radiusKm: Number(formValues.radiusKm),
    includeTimeCost: formValues.includeTimeCost === "on",
    hourlyWage: Number(formValues.hourlyWage || 0),
    detailMode: formValues.detailMode,
  };
}

function getCurrentLocation() {
  if (!("geolocation" in navigator)) {
    return Promise.reject(new Error("geolocation_unsupported"));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      (error) => reject(error),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 120000,
      }
    );
  });
}

function normalizeLocationError(error) {
  if (error?.code === 1) {
    return "現在地を取得できませんでした。位置情報を許可してください。";
  }

  if (error?.message === "geolocation_unsupported") {
    return "このブラウザでは位置情報を利用できません。";
  }

  return "現在地を取得できませんでした。位置情報を許可してください。";
}

async function fetchNearbyStations(location, radiusKm) {
  const query = `
[out:json][timeout:8];
(
  node["amenity"="fuel"](around:${Math.round(radiusKm * 1000)},${location.lat},${location.lng});
  way["amenity"="fuel"](around:${Math.round(radiusKm * 1000)},${location.lat},${location.lng});
  relation["amenity"="fuel"](around:${Math.round(radiusKm * 1000)},${location.lat},${location.lng});
);
out center tags;
`;

  let payload = null;
  for (const endpoint of overpassEndpoints) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort("overpass_timeout"), OVERPASS_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: query.trim() }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn("overpass endpoint returned non-ok status", endpoint, response.status);
        continue;
      }

      payload = await response.json();
      break;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error?.name === "AbortError") {
        continue;
      }
      console.warn("overpass fetch failed", endpoint, error);
    }
  }

  if (!payload?.elements?.length) {
    return [];
  }

  const parsedStations = payload.elements
    .map((element) => parseStationElement(element, location))
    .filter(Boolean)
    .sort((a, b) => a.geoDistanceKm - b.geoDistanceKm);

  return dedupeStations(parsedStations).slice(0, MAX_RESULTS);
}

async function fetchMunicipalityPriceData(location, fuelType) {
  try {
    const baseUrl = PRICE_API_BASE ? `${PRICE_API_BASE}/api/prices` : "/api/prices";
    const response = await fetch(
      `${baseUrl}?lat=${encodeURIComponent(location.lat)}&lng=${encodeURIComponent(
        location.lng
      )}&fuelType=${encodeURIComponent(fuelType)}`
    );

    if (!response.ok) {
      throw new Error(`municipality_price_status_${response.status}`);
    }

    const payload = await response.json();
    if (!payload || typeof payload !== "object") {
      return null;
    }

    return payload;
  } catch (error) {
    console.warn("municipality price lookup failed", error);
    return null;
  }
}

function getPriceApiBase() {
  const configured = window.GASRANK_API_BASE;
  if (!configured) {
    return "";
  }

  return String(configured).replace(/\/+$/, "");
}

function attachMunicipalityPrices(stations, pricePayload, fuelType) {
  if (!pricePayload) {
    return stations.map((station) => ({
      ...station,
      municipalityPriceMatch: null,
      marketPricePerLiter: null,
      marketPriceUpdatedAt: "",
    }));
  }

  const marketPricePerLiter = Number.isFinite(pricePayload.averages?.[fuelType])
    ? pricePayload.averages[fuelType]
    : null;
  const matchedStations = matchStationsToMunicipalityShops(stations, pricePayload.shops || []);

  return stations.map((station) => {
    const matched = matchedStations.get(station.id) || null;
    return {
      ...station,
      municipalityPriceMatch: matched
        ? {
            ...matched.shop,
            matchScore: matched.score,
          }
        : null,
      marketPricePerLiter,
      marketPriceUpdatedAt: pricePayload.averageUpdatedAt || "",
    };
  });
}

function matchStationsToMunicipalityShops(stations, shops) {
  if (!stations.length || !shops.length) {
    return new Map();
  }

  const candidates = [];

  for (const station of stations) {
    for (const shop of shops) {
      const score = scorePriceMatch(station, shop);
      if (score >= 0.48) {
        candidates.push({
          stationId: station.id,
          shopId: shop.shopId,
          shop,
          score,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const assignedStations = new Set();
  const assignedShops = new Set();
  const matches = new Map();

  for (const candidate of candidates) {
    if (assignedStations.has(candidate.stationId) || assignedShops.has(candidate.shopId)) {
      continue;
    }

    assignedStations.add(candidate.stationId);
    assignedShops.add(candidate.shopId);
    matches.set(candidate.stationId, {
      shop: candidate.shop,
      score: candidate.score,
    });
  }

  return matches;
}

function scorePriceMatch(station, shop) {
  const stationName = normalizeMatchText(station.name);
  const shopName = normalizeMatchText(shop.name);
  const stationAddress = normalizeAddressText(station.address);
  const shopAddress = normalizeAddressText(shop.address);
  const stationCombined = `${stationName}${stationAddress}`;
  const shopCombined = `${shopName}${shopAddress}`;

  const nameSimilarity = compareMatchText(stationName, shopName);
  const addressSimilarity = compareMatchText(stationAddress, shopAddress);
  const combinedSimilarity = compareMatchText(stationCombined, shopCombined);
  const brandBonus =
    normalizeBrandText(station.brand || station.name) &&
    normalizeBrandText(station.brand || station.name) === normalizeBrandText(shop.name)
      ? 0.08
      : 0;
  const addressNumberBonus = overlappingTokenRatio(
    extractNumericTokens(stationAddress),
    extractNumericTokens(shopAddress)
  );

  if (nameSimilarity < 0.24 && addressSimilarity < 0.18 && combinedSimilarity < 0.28) {
    return 0;
  }

  let score =
    nameSimilarity * 0.56 +
    addressSimilarity * 0.24 +
    combinedSimilarity * 0.12 +
    addressNumberBonus * 0.2 +
    brandBonus;

  if (stationName && shopName && (stationName === shopName || stationName.includes(shopName) || shopName.includes(stationName))) {
    score += 0.12;
  }

  return Math.max(0, Math.min(score, 1));
}

function compareMatchText(left, right) {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  if (left.includes(right) || right.includes(left)) {
    return 0.86;
  }

  return bigramSimilarity(left, right);
}

function normalizeMatchText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)|（[^）]*）/g, " ")
    .replace(/株式会社|有限会社|合同会社|合名会社|合資会社/g, " ")
    .replace(/\(株\)|（株）|\(有\)|（有）/g, " ")
    .replace(/サービスステーション|ガソリンスタンド|給油所/g, " ")
    .replace(/[\/・･]/g, " ")
    .replace(/[^\w\u3040-\u30ff\u3400-\u9fff]+/g, "")
    .trim();
}

function normalizeAddressText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/丁目/g, "-")
    .replace(/番地/g, "-")
    .replace(/番/g, "-")
    .replace(/号/g, "")
    .replace(/[^\w\u3040-\u30ff\u3400-\u9fff-]+/g, "")
    .replace(/-+/g, "-")
    .trim();
}

function normalizeBrandText(value) {
  const text = normalizeMatchText(value);

  if (text.includes("eneos") || text.includes("エネオス")) return "eneos";
  if (text.includes("apollostation") || text.includes("apollo") || text.includes("出光") || text.includes("idemitsu")) {
    return "apollostation";
  }
  if (text.includes("cosmo") || text.includes("コスモ")) return "cosmo";
  if (text.includes("shell") || text.includes("シェル")) return "shell";
  if (text === "ja" || text.includes("農協")) return "ja";

  return "";
}

function extractNumericTokens(value) {
  return (String(value).match(/\d+/g) || []).filter(Boolean);
}

function overlappingTokenRatio(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const rightSet = new Set(rightTokens);
  const overlapCount = leftTokens.filter((token) => rightSet.has(token)).length;

  return overlapCount === 0 ? 0 : overlapCount / Math.max(leftTokens.length, rightTokens.length);
}

function bigramSimilarity(left, right) {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  if (left.length < 2 || right.length < 2) {
    return 0;
  }

  const leftMap = new Map();
  let leftCount = 0;
  let rightCount = 0;
  let overlap = 0;

  for (let index = 0; index < left.length - 1; index += 1) {
    const token = left.slice(index, index + 2);
    leftMap.set(token, (leftMap.get(token) || 0) + 1);
    leftCount += 1;
  }

  for (let index = 0; index < right.length - 1; index += 1) {
    const token = right.slice(index, index + 2);
    rightCount += 1;

    const available = leftMap.get(token) || 0;
    if (available > 0) {
      overlap += 1;
      leftMap.set(token, available - 1);
    }
  }

  return overlap === 0 ? 0 : (overlap * 2) / (leftCount + rightCount);
}

function parseStationElement(element, userLocation) {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const tags = element.tags || {};
  const brand = tags.brand || guessBrand(tags.name || "");
  const livePrices = parseLivePrices(tags);
  const geoDistanceKm = haversineKm(userLocation.lat, userLocation.lng, lat, lng);

  return {
    id: `${element.type}-${element.id}`,
    name: tags.name || brand || "名称未登録スタンド",
    brand: brand || "ブランド不明",
    address: buildAddress(tags),
    lat,
    lng,
    geoDistanceKm,
    openStatus: deriveOpenStatus(tags),
    openingHours: tags.opening_hours || "営業時間情報なし",
    livePrices,
    rawUpdatedAt: tags.check_date || tags["fuel:date"] || tags["survey:date"] || "",
  };
}

function parseLivePrices(tags) {
  const keys = {
    regular: [
      "price:regular",
      "price:gasoline",
      "price:petrol",
      "fuel:octane_90",
      "fuel:octane_91",
      "fuel:octane_95",
    ],
    premium: ["price:premium", "price:high_octane", "price:high-octane"],
    diesel: ["price:diesel", "fuel:diesel"],
  };

  return Object.fromEntries(
    Object.entries(keys).map(([fuelType, candidates]) => {
      const match = candidates
        .map((key) => parseNumericPrice(tags[key]))
        .find((value) => Number.isFinite(value));
      return [fuelType, match ?? null];
    })
  );
}

function parseNumericPrice(value) {
  if (value == null) {
    return null;
  }

  const numeric = Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric >= 500) {
    return null;
  }

  return Math.round(numeric);
}

function buildAddress(tags) {
  const joined = [
    tags["addr:province"],
    tags["addr:city"],
    tags["addr:suburb"],
    tags["addr:street"],
    tags["addr:housenumber"],
  ]
    .filter(Boolean)
    .join("");

  if (joined) {
    return joined;
  }

  return tags["addr:full"] || tags.address || "住所情報なし";
}

function deriveOpenStatus(tags) {
  if (tags.opening_hours === "24/7") {
    return "24時間営業";
  }
  if (tags.opening_hours) {
    return "営業時間あり";
  }
  return "営業時間要確認";
}

function guessBrand(name) {
  const normalized = String(name || "").normalize("NFKC").toLowerCase();
  if (normalized.includes("eneos") || normalized.includes("エネオス")) return "ENEOS";
  if (
    normalized.includes("idemitsu") ||
    normalized.includes("apollo") ||
    normalized.includes("apollostation") ||
    normalized.includes("出光") ||
    normalized.includes("アポロ")
  ) {
    return "apollostation";
  }
  if (normalized.includes("cosmo") || normalized.includes("コスモ")) return "COSMO";
  if (normalized.includes("shell") || normalized.includes("シェル")) return "Shell";
  if (normalized === "ja" || normalized.includes("農協")) return "JA";
  return "";
}

function dedupeStations(stations) {
  const seen = new Set();
  return stations.filter((station) => {
    const key = `${station.name}:${station.lat.toFixed(5)}:${station.lng.toFixed(5)}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function enrichStationsWithRouteMetrics(location, stations) {
  if (stations.length === 0) {
    return [];
  }

  try {
    const coordinates = [
      `${location.lng},${location.lat}`,
      ...stations.map((station) => `${station.lng},${station.lat}`),
    ];
    const url = `https://router.project-osrm.org/table/v1/driving/${coordinates.join(
      ";"
    )}?sources=0&annotations=distance,duration`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("route_lookup_failed");
    }

    const payload = await response.json();
    const distances = payload.distances?.[0] || [];
    const durations = payload.durations?.[0] || [];

    return stations.map((station, index) =>
      withRouteFallback(station, distances[index + 1], durations[index + 1])
    );
  } catch (error) {
    console.warn("route lookup failed, using fallback", error);
    return stations.map((station) => withRouteFallback(station));
  }
}

function withRouteFallback(station, routedDistanceMeters, routedDurationSeconds) {
  const fallbackRoadKm = Math.max(station.geoDistanceKm * 1.28, 0.7);
  const distanceKm = Number.isFinite(routedDistanceMeters)
    ? routedDistanceMeters / 1000
    : fallbackRoadKm;
  const durationMinutes = Number.isFinite(routedDurationSeconds)
    ? routedDurationSeconds / 60
    : Math.max((distanceKm / 28) * 60, 3);

  return {
    ...station,
    distanceKm,
    durationMinutes,
  };
}

function buildRankedStations(stations, rawFormValues) {
  const formValues = normalizeFormValues(rawFormValues);

  const computedStations = stations
    .map((station) => {
      const pricing = resolvePricing(station, formValues);
      const driveFuelLiters = (station.distanceKm * 2) / formValues.efficiency;
      const driveFuelCost = driveFuelLiters * pricing.pricePerLiter;
      const fuelingCost = pricing.pricePerLiter * formValues.liters;
      const timeCost = formValues.includeTimeCost
        ? ((station.durationMinutes * 2) / 60) * formValues.hourlyWage
        : 0;
      const totalCost = fuelingCost + driveFuelCost + timeCost;

      return {
        ...station,
        ...pricing,
        driveFuelLiters,
        driveFuelCost,
        fuelingCost,
        timeCost,
        totalCost,
      };
    })
    .sort((a, b) => {
      const primary = a.totalCost - b.totalCost;
      if (primary !== 0) return primary;
      const duration = a.durationMinutes - b.durationMinutes;
      if (duration !== 0) return duration;
      const distance = a.distanceKm - b.distanceKm;
      if (distance !== 0) return distance;
      return b.updatedAtWeight - a.updatedAtWeight;
    })
    .map((station, index) => ({
      ...station,
      rankByTotal: index + 1,
    }));

  if (computedStations.length === 0) {
    state.priceCoverage = {
      actual: 0,
      market: 0,
      estimated: 0,
    };
    state.dataSource = "idle";
    return [];
  }

  state.priceCoverage = computedStations.reduce(
    (coverage, station) => {
      coverage[station.priceSourceKind] = (coverage[station.priceSourceKind] || 0) + 1;
      return coverage;
    },
    {
      actual: 0,
      market: 0,
      estimated: 0,
    }
  );

  state.dataSource =
    state.priceCoverage.actual === computedStations.length
      ? "live"
      : state.priceCoverage.actual > 0 || state.priceCoverage.market > 0
      ? "mixed"
      : "demo";

  const baseline = [...computedStations].sort((a, b) => a.durationMinutes - b.durationMinutes)[0];
  const lowestPrice = [...computedStations].sort((a, b) => a.pricePerLiter - b.pricePerLiter)[0];

  return computedStations.map((station) => {
    const savingsVsBaseline = baseline.totalCost - station.totalCost;
    return {
      ...station,
      savingsVsBaseline,
      reason: buildReasonText(station, baseline, lowestPrice, formValues, savingsVsBaseline),
      recommendation: buildSavingsText(station, baseline, savingsVsBaseline),
    };
  });
}

function resolvePricing(station, formValues) {
  const liveBasePrice = station.livePrices?.[formValues.fuelType];
  const appliedDiscount = PRICE_TYPE_DISCOUNTS[formValues.priceType] ?? 0;
  const matchedPrices = station.municipalityPriceMatch?.prices || {};
  const matchedUpdatedAt = station.municipalityPriceMatch?.updatedAt || {};

  const matchedCandidate = selectKnownPriceCandidate(
    matchedPrices,
    matchedUpdatedAt,
    formValues.priceType,
    "\u5b9f\u4fa1\u683c",
    "\u5b9f\u4fa1\u683c\u88dc\u6b63"
  );
  const liveCandidate = Number.isFinite(liveBasePrice)
    ? buildPriceCandidate(
        Math.max(Math.round(liveBasePrice - appliedDiscount), 1),
        formValues.priceType === "cash" ? "\u73fe\u5730\u4fa1\u683c" : "\u73fe\u5730\u4fa1\u683c\u88dc\u6b63",
        "actual",
        station.rawUpdatedAt
      )
    : null;

  if (matchedCandidate && (!liveCandidate || matchedCandidate.updatedAtWeight >= liveCandidate.updatedAtWeight)) {
    return matchedCandidate;
  }

  if (liveCandidate) {
    return liveCandidate;
  }

  if (Number.isFinite(liveBasePrice)) {
    return {
      pricePerLiter: Math.max(Math.round(liveBasePrice - appliedDiscount), 1),
      priceSourceLabel: "実データ",
      isEstimatedPrice: false,
      updatedLabel: station.rawUpdatedAt ? formatDate(station.rawUpdatedAt) : "更新時刻不明",
      updatedAtWeight: station.rawUpdatedAt ? Date.parse(station.rawUpdatedAt) || 0 : 0,
    };
  }

  if (Number.isFinite(station.marketPricePerLiter)) {
    const marketBrandKey = String(station.brand || "")
      .toLowerCase()
      .replace(/\s/g, "");
    const marketBrandOffset = BRAND_PRICE_OFFSETS[marketBrandKey] ?? 0;
    const adjustedMarketBase = Math.round(station.marketPricePerLiter + marketBrandOffset * 0.6);

    return buildPriceCandidate(
      Math.max(Math.round(adjustedMarketBase - appliedDiscount), 1),
      formValues.priceType === "cash" ? "\u5730\u57df\u76f8\u5834" : "\u5730\u57df\u76f8\u5834\u88dc\u6b63",
      "market",
      station.marketPriceUpdatedAt
    );
  }

  const brandKey = String(station.brand || "")
    .toLowerCase()
    .replace(/\s/g, "");
  const brandOffset = BRAND_PRICE_OFFSETS[brandKey] ?? 0;
  const noise = (hashValue(station.id) % 9) - 4;
  const distanceDiscount = Math.min(3, station.distanceKm * 0.55);
  const estimated = Math.round(
    BASE_PRICES[formValues.fuelType] + brandOffset + noise - distanceDiscount - appliedDiscount
  );
  const estimatedHoursAgo = (hashValue(`${station.id}:time`) % 15) + 1;

  return {
    pricePerLiter: estimated,
    priceSourceLabel: "推定価格",
    isEstimatedPrice: true,
    updatedLabel: `推定 ${estimatedHoursAgo}時間前`,
    updatedAtWeight: Date.now() - estimatedHoursAgo * 3600 * 1000,
    priceSourceKind: "estimated",
  };
}

function selectKnownPriceCandidate(prices, updatedAtMap, targetPriceType, exactLabel, adjustedLabel) {
  const preferredSourceTypes =
    targetPriceType === "cash"
      ? ["cash", "member"]
      : targetPriceType === "member"
      ? ["member", "cash"]
      : ["member", "cash"];

  for (const sourceType of preferredSourceTypes) {
    const sourcePrice = prices?.[sourceType];
    if (!Number.isFinite(sourcePrice)) {
      continue;
    }

    return buildPriceCandidate(
      Math.max(Math.round(convertPriceByType(sourcePrice, sourceType, targetPriceType)), 1),
      sourceType === targetPriceType ? exactLabel : adjustedLabel,
      "actual",
      updatedAtMap?.[sourceType] || ""
    );
  }

  return null;
}

function convertPriceByType(price, fromType, toType) {
  const fromDiscount = PRICE_TYPE_DISCOUNTS[fromType] ?? 0;
  const toDiscount = PRICE_TYPE_DISCOUNTS[toType] ?? 0;
  return price - (toDiscount - fromDiscount);
}

function buildPriceCandidate(pricePerLiter, priceSourceLabel, priceSourceKind, updatedAtRaw) {
  return {
    pricePerLiter,
    priceSourceLabel,
    priceSourceKind,
    isEstimatedPrice: priceSourceKind === "estimated",
    updatedLabel: updatedAtRaw ? formatKnownDate(updatedAtRaw) : "譖ｴ譁ｰ譎ょ綾荳肴・",
    updatedAtWeight: getDateWeight(updatedAtRaw),
  };
}

function formatKnownDate(value) {
  const parsed = parseDateInfo(value);
  if (!parsed) {
    return formatDate(value);
  }

  const { date, hasHour } = parsed;
  const base = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(
    date.getDate()
  ).padStart(2, "0")}`;

  return hasHour ? `${base} ${String(date.getHours()).padStart(2, "0")}:00` : base;
}

function buildReasonText(station, baseline, lowestPrice, formValues, savingsVsBaseline) {
  if (station.rankByTotal === 1 && station.id === baseline.id) {
    return "近いため移動コストが小さく、今回の条件では実質最安です。";
  }

  if (station.rankByTotal === 1) {
    return formValues.liters >= 20
      ? "単価差が効きやすい給油量のため、少し遠くても行く価値があります。"
      : "距離増を上回る価格メリットがあり、総額で最上位です。";
  }

  if (station.id === lowestPrice.id) {
    return `店頭価格は最安ですが、移動込みでは ${station.rankByTotal} 位です。`;
  }

  if (savingsVsBaseline > 0) {
    return "最寄り候補より安く、移動コスト込みでも節約できます。";
  }

  if (formValues.liters <= 5) {
    return "少量給油では単価差より移動コストの影響が大きくなります。";
  }

  return "距離や時間を含めると、今回は優先度が下がります。";
}

function buildSavingsText(station, baseline, savingsVsBaseline) {
  if (station.id === baseline.id) {
    return "比較基準の最短時間スタンドです。";
  }

  if (savingsVsBaseline >= 0) {
    return `最寄り候補より ${formatCurrency(savingsVsBaseline)} お得`;
  }

  return `最寄り候補より ${formatCurrency(Math.abs(savingsVsBaseline))} 高い`;
}

function renderSortTabs() {
  [...elements.sortTabs.querySelectorAll("[data-sort]")].forEach((button) => {
    button.classList.toggle("active", button.dataset.sort === state.sort);
  });
}

function renderLoadingCard() {
  return `
    <article class="loading-card">
      <div class="loading-card-head">
        <span class="loading-spinner" aria-hidden="true"></span>
        <strong>検索中</strong>
      </div>
      <p class="loading-card-message">${escapeHtml(state.loadingMessage || "データを取得しています…")}</p>
      <p class="loading-card-note">10秒ほどこのままお待ちください。</p>
      <div class="loading-progress" aria-hidden="true">
        <span></span>
      </div>
    </article>
  `;
}

function renderResults() {
  renderSummary();
  renderBanner();
  renderMapPanel();

  if (state.loading) {
    elements.resultsList.innerHTML = renderLoadingCard();
    return;
    elements.resultsList.innerHTML = `
      <article class="loading-card">
        <strong>検索中</strong>
        <p>${escapeHtml(state.loadingMessage || "データを取得しています…")}</p>
      </article>
    `;
    return;
  }

  if (state.errorMessage) {
    elements.resultsList.innerHTML = `
      <article class="empty-card">
        <h3>検索に失敗しました</h3>
        <p>${escapeHtml(state.errorMessage)}</p>
      </article>
    `;
    return;
  }

  if (!state.results.length) {
    elements.resultsList.innerHTML = `
      <article class="empty-card">
        <h3>まだ検索していません</h3>
        <p>現在地、燃費、給油量を入力すると、移動コスト込みで比較できます。</p>
      </article>
    `;
    return;
  }

  const sorted = sortResults(state.results, state.sort);
  const detailMode = state.lastSearch?.detailMode || "simple";

  elements.resultsList.innerHTML = sorted
    .map((station, index) => renderResultCard(station, index + 1, detailMode))
    .join("");
}

function renderSummary() {
  if (!state.lastSearch) {
    elements.searchSummary.className = "search-summary summary-empty";
    elements.searchSummary.textContent =
      "条件を入力して検索すると、実質総コスト順のランキングを表示します。";
    return;
  }

  const search = state.lastSearch;
  const meta = [
    FUEL_LABELS[search.fuelType],
    `燃費 ${search.efficiency}km/L`,
    `${search.liters}L 給油`,
    PRICE_TYPE_LABELS[search.priceType],
    `${search.radiusKm}km 圏内`,
    `時間コスト ${search.includeTimeCost ? "ON" : "OFF"}`,
  ];

  if (search.includeTimeCost) {
    meta.push(`時給 ${formatCurrency(search.hourlyWage)}/h`);
  }

  elements.searchSummary.className = "search-summary";
  elements.searchSummary.innerHTML = `
    <p class="summary-title">現在地ベースで ${state.results.length} 件を比較</p>
    <div class="summary-meta">
      ${meta.map((item) => `<span class="meta-chip">${escapeHtml(item)}</span>`).join("")}
      <span class="meta-chip">${escapeHtml(state.locationLabel)}</span>
    </div>
  `;
}

function renderBanner() {
  if (!state.lastSearch || !state.results.length) {
    elements.resultsBanner.innerHTML = "";
    return;
  }

  const best = [...state.results].sort((a, b) => a.totalCost - b.totalCost)[0];
  const baseline = [...state.results].sort((a, b) => a.durationMinutes - b.durationMinutes)[0];
  const savings = baseline.totalCost - best.totalCost;
  const hints = [];

  if (best.id === baseline.id || savings < 60) {
    hints.push({
      kind: "warning",
      title: "近場利用が有力です",
      body: "最安値を追っても節約額は小さく、最短時間のスタンド利用が合理的です。",
    });
  } else {
    hints.push({
      kind: "positive",
      title: "今回の条件では遠回りする価値があります",
      body: `${best.name} は最短時間の候補より ${formatCurrency(
        savings
      )} 低く、移動込みでもお得です。`,
    });
  }

  if (state.lastSearch.liters <= 5) {
    hints.push({
      kind: "muted",
      title: "少量給油の傾向",
      body: "5L 前後では単価差より移動コストが効きやすく、近場の優位が出やすくなります。",
    });
  } else if (state.lastSearch.liters >= 20) {
    hints.push({
      kind: "muted",
      title: "今回の給油量",
      body: "20L 以上では単価差の影響が大きくなり、少し遠い店舗が逆転しやすくなります。",
    });
  }

  if (state.dataSource !== "live" && state.priceCoverage.actual === 0 && state.priceCoverage.market === 0) {
    hints.push({
      kind: "muted",
      title: "価格データについて",
      body:
        state.dataSource === "demo"
          ? "店舗は現在地周辺の実データを優先し、価格は MVP 用の推定価格で比較しています。"
          : "価格が取得できた店舗は実データ、未取得の店舗は推定価格で補完しています。",
    });
  }

  const coverageSummary = `\u5b9f\u4fa1\u683c ${state.priceCoverage.actual}\u4ef6 / \u5730\u57df\u76f8\u5834 ${state.priceCoverage.market}\u4ef6 / \u63a8\u5b9a ${state.priceCoverage.estimated}\u4ef6`;
  hints.push({
    kind: state.priceCoverage.estimated > 0 ? "muted" : "positive",
    title: "\u4fa1\u683c\u30bd\u30fc\u30b9",
    body:
      state.priceCoverage.estimated > 0
        ? `${coverageSummary}\u3002\u63a8\u5b9a\u306f\u88dc\u52a9\u7684\u306a\u5834\u5408\u3060\u3051\u4f7f\u3063\u3066\u3044\u307e\u3059\u3002`
        : `${coverageSummary}\u3002\u4eca\u56de\u306f\u63a8\u5b9a\u4fa1\u683c\u3092\u4f7f\u3063\u3066\u3044\u307e\u305b\u3093\u3002`,
  });

  elements.resultsBanner.innerHTML = hints
    .map(
      (hint) => `
      <article class="banner-card banner-${hint.kind}">
        <strong>${escapeHtml(hint.title)}</strong>
        <p>${escapeHtml(hint.body)}</p>
      </article>
    `
    )
    .join("");
}

function renderMapPanel() {
  if (!state.lastSearch || !state.results.length) {
    elements.resultMapPanel.innerHTML = "";
    return;
  }

  const activeStation =
    state.results.find((station) => station.id === state.activeMapStationId) || state.results[0];

  if (!activeStation) {
    elements.resultMapPanel.innerHTML = "";
    return;
  }

  const appleMapsUrl = buildAppleMapsUrl(activeStation);
  const googleMapsUrl = buildGoogleMapsUrl(activeStation);
  const mapEmbedUrl = buildMapEmbedUrl(activeStation);

  elements.resultMapPanel.innerHTML = `
    <section class="map-panel">
      <div class="map-panel-head">
        <div class="map-panel-copy">
          <strong>${escapeHtml(activeStation.name)} の場所</strong>
          <p>${escapeHtml(activeStation.address)}</p>
        </div>
        <div class="map-panel-controls">
          <span class="card-badge badge-muted">${formatDistance(activeStation.distanceKm)} / ${formatMinutes(
            activeStation.durationMinutes
          )}</span>
          ${
            isMobileViewport()
              ? `<button type="button" class="detail-button secondary" data-toggle-map-panel="true">${
                  state.isMapExpanded ? "地図を閉じる" : "地図を表示"
                }</button>`
              : ""
          }
        </div>
      </div>
      ${
        !isMobileViewport() || state.isMapExpanded
          ? `<iframe
              class="map-frame"
              title="${escapeHtml(activeStation.name)} の地図"
              src="${escapeHtml(mapEmbedUrl)}"
              loading="lazy"
              referrerpolicy="no-referrer-when-downgrade"
            ></iframe>`
          : ""
      }
      <div class="map-actions">
        <a class="map-button map-button-primary" href="${escapeHtml(appleMapsUrl)}" target="_blank" rel="noreferrer">
          Appleマップで開く
        </a>
        <a class="map-button map-button-secondary" href="${escapeHtml(googleMapsUrl)}" target="_blank" rel="noreferrer">
          Googleマップで開く
        </a>
      </div>
    </section>
  `;
}

function buildMapEmbedUrl(station) {
  const lat = Number(station.lat);
  const lng = Number(station.lng);
  const delta = 0.008;
  const left = (lng - delta).toFixed(6);
  const right = (lng + delta).toFixed(6);
  const top = (lat + delta).toFixed(6);
  const bottom = (lat - delta).toFixed(6);
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat.toFixed(
    6
  )}%2C${lng.toFixed(6)}`;
}

function buildAppleMapsUrl(station) {
  const label = encodeURIComponent(station.name);
  return `https://maps.apple.com/?daddr=${station.lat.toFixed(6)},${station.lng.toFixed(
    6
  )}&dirflg=d&q=${label}`;
}

function buildGoogleMapsUrl(station) {
  return `https://www.google.com/maps/dir/?api=1&destination=${station.lat.toFixed(
    6
  )},${station.lng.toFixed(6)}&travelmode=driving&dir_action=navigate`;
}

function sortResults(results, sortKey) {
  const ordered = [...results];
  switch (sortKey) {
    case "price":
      ordered.sort((a, b) => a.pricePerLiter - b.pricePerLiter || a.totalCost - b.totalCost);
      break;
    case "duration":
      ordered.sort((a, b) => a.durationMinutes - b.durationMinutes || a.totalCost - b.totalCost);
      break;
    case "distance":
      ordered.sort((a, b) => a.distanceKm - b.distanceKm || a.totalCost - b.totalCost);
      break;
    default:
      ordered.sort((a, b) => a.totalCost - b.totalCost || a.durationMinutes - b.durationMinutes);
      break;
  }
  return ordered;
}

function renderResultCard(station, displayRank, detailMode) {
  const detailSection =
    detailMode === "detailed"
      ? `
        <div class="result-detail">
          ${renderDetailRows(station)}
        </div>
      `
      : "";

  return `
    <article class="result-card ${displayRank === 1 ? "top-ranked" : ""}">
      <div class="card-header">
        <div class="rank-block">
          <div class="rank-badge">#${displayRank}</div>
          <div>
            <h3>${escapeHtml(station.name)}</h3>
            <div class="station-subline">
              <span class="card-badge ${station.openStatus === "24時間営業" ? "badge-open" : "badge-muted"}">
                ${escapeHtml(station.openStatus)}
              </span>
              <span class="card-badge badge-muted">${escapeHtml(station.brand)}</span>
              <span class="card-badge ${station.isEstimatedPrice ? "badge-estimated" : "badge-muted"}">
                ${escapeHtml(station.priceSourceLabel)}
              </span>
            </div>
          </div>
        </div>
        <div class="cost-block">
          <p class="cost-label">実質総コスト</p>
          <p class="cost-total">${formatCurrency(station.totalCost)}</p>
        </div>
      </div>

      <div class="result-grid">
        <div class="metric-tile">
          <span class="metric-label">店頭価格</span>
          <span class="metric-value">${formatCurrency(station.pricePerLiter)}/L</span>
        </div>
        <div class="metric-tile metric-secondary">
          <span class="metric-label">給油代</span>
          <span class="metric-value">${formatCurrency(station.fuelingCost)}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">距離</span>
          <span class="metric-value">${formatDistance(station.distanceKm)}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">所要時間</span>
          <span class="metric-value">${formatMinutes(station.durationMinutes)}</span>
        </div>
        <div class="metric-tile metric-secondary">
          <span class="metric-label">移動燃料コスト</span>
          <span class="metric-value">${formatCurrency(station.driveFuelCost)}</span>
        </div>
        <div class="metric-tile metric-secondary">
          <span class="metric-label">時間コスト</span>
          <span class="metric-value">${
            state.lastSearch?.includeTimeCost ? formatCurrency(station.timeCost) : "OFF"
          }</span>
        </div>
        <div class="metric-tile metric-secondary">
          <span class="metric-label">更新時刻</span>
          <span class="metric-value">${escapeHtml(station.updatedLabel)}</span>
        </div>
      </div>

      <p class="result-note">${escapeHtml(station.reason)}</p>
      ${detailSection}

      <div class="card-footer">
        <p class="savings-copy">${escapeHtml(station.recommendation)}</p>
        <div class="map-actions">
          <button type="button" class="detail-button secondary" data-map-station-id="${escapeHtml(
            station.id
          )}">
            地図に表示
          </button>
          <button type="button" class="detail-button" data-station-id="${escapeHtml(station.id)}">
            内訳を見る
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderDetailRows(station) {
  const timeValue = state.lastSearch?.includeTimeCost ? `${formatCurrency(station.timeCost)}` : "OFF";
  return `
    <div class="detail-row"><span>給油代</span><strong>${formatCurrency(station.fuelingCost)}</strong></div>
    <div class="detail-row"><span>移動燃料コスト</span><strong>${formatCurrency(station.driveFuelCost)}</strong></div>
    <div class="detail-row"><span>時間コスト</span><strong>${timeValue}</strong></div>
    <div class="detail-row"><span>往復移動で消費する燃料</span><strong>${station.driveFuelLiters.toFixed(2)}L</strong></div>
  `;
}

function handleResultCardClick(event) {
  const mapPanelToggle = event.target.closest("[data-toggle-map-panel]");
  if (mapPanelToggle) {
    state.isMapExpanded = !state.isMapExpanded;
    renderMapPanel();
    return;
  }

  const mapTrigger = event.target.closest("[data-map-station-id]");
  if (mapTrigger) {
    state.activeMapStationId = mapTrigger.dataset.mapStationId;
    state.isMapExpanded = true;
    renderMapPanel();
    elements.resultMapPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

  const trigger = event.target.closest("[data-station-id]");
  if (!trigger) {
    return;
  }

  const station = state.results.find((item) => item.id === trigger.dataset.stationId);
  if (!station) {
    return;
  }

  state.activeMapStationId = station.id;
  state.isMapExpanded = true;
  renderMapPanel();
  renderDialog(station);
}

function renderDialog(station) {
  elements.dialogContent.innerHTML = `
    <div class="dialog-content">
      <div class="dialog-title-row">
        <div>
          <p class="section-kicker">Station Detail</p>
          <h3>${escapeHtml(station.name)}</h3>
        </div>
        <div class="cost-block">
          <p class="cost-label">実質総コスト</p>
          <p class="cost-total">${formatCurrency(station.totalCost)}</p>
        </div>
      </div>

      <p>${escapeHtml(station.address)}</p>
      <p>${escapeHtml(station.reason)}</p>

      <div class="dialog-grid">
        <div class="metric-tile">
          <span class="metric-label">店頭価格</span>
          <span class="metric-value">${formatCurrency(station.pricePerLiter)}/L</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">給油量</span>
          <span class="metric-value">${state.lastSearch?.liters ?? "-"}L</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">給油代</span>
          <span class="metric-value">${formatCurrency(station.fuelingCost)}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">距離</span>
          <span class="metric-value">${formatDistance(station.distanceKm)}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">所要時間</span>
          <span class="metric-value">${formatMinutes(station.durationMinutes)}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">移動燃料コスト</span>
          <span class="metric-value">${formatCurrency(station.driveFuelCost)}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">時間コスト</span>
          <span class="metric-value">${
            state.lastSearch?.includeTimeCost ? formatCurrency(station.timeCost) : "OFF"
          }</span>
        </div>
        <div class="metric-tile">
          <span class="metric-label">価格更新時刻</span>
          <span class="metric-value">${escapeHtml(station.updatedLabel)}</span>
        </div>
      </div>

      <iframe
        class="map-frame"
        title="${escapeHtml(station.name)} の地図"
        src="${escapeHtml(buildMapEmbedUrl(station))}"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>

      <div class="map-actions">
        <a class="map-button map-button-primary" href="${escapeHtml(
          buildAppleMapsUrl(station)
        )}" target="_blank" rel="noreferrer">
          Appleマップで開く
        </a>
        <a class="map-button map-button-secondary" href="${escapeHtml(
          buildGoogleMapsUrl(station)
        )}" target="_blank" rel="noreferrer">
          Googleマップで開く
        </a>
      </div>

      <div class="result-detail">
        <div class="detail-row"><span>営業状況</span><strong>${escapeHtml(station.openStatus)}</strong></div>
        <div class="detail-row"><span>住所</span><strong>${escapeHtml(station.address)}</strong></div>
        <div class="detail-row"><span>価格種別</span><strong>${escapeHtml(
          PRICE_TYPE_LABELS[state.lastSearch?.priceType || "cash"]
        )}</strong></div>
        <div class="detail-row"><span>なぜこの順位か</span><strong>${escapeHtml(station.reason)}</strong></div>
      </div>
    </div>
  `;

  if (typeof elements.stationDialog.showModal === "function") {
    if (elements.stationDialog.open) {
      elements.stationDialog.close();
    }
    elements.stationDialog.showModal();
  }
}

function buildFallbackStations(location) {
  const seedStations = [
    { name: "ENEOS Drive Gate", brand: "ENEOS", bearing: 25, km: 1.1 },
    { name: "Cosmo Quick Fill", brand: "COSMO", bearing: 110, km: 2.4 },
    { name: "apollostation Link", brand: "apollostation", bearing: 205, km: 3.1 },
    { name: "JAセルフステーション", brand: "JA", bearing: 285, km: 4.6 },
    { name: "Shell Mobility", brand: "Shell", bearing: 330, km: 1.8 },
  ];

  return seedStations.map((seed, index) => {
    const coords = projectCoordinate(location, seed.km, seed.bearing);
    return {
      id: `fallback-${index}`,
      name: seed.name,
      brand: seed.brand,
      address: "周辺価格 API 未接続時のデモ候補",
      lat: coords.lat,
      lng: coords.lng,
      geoDistanceKm: seed.km,
      openStatus: "営業時間要確認",
      openingHours: "営業時間情報なし",
      livePrices: {
        regular: null,
        premium: null,
        diesel: null,
      },
      rawUpdatedAt: "",
    };
  });
}

function projectCoordinate(origin, distanceKm, bearingDeg) {
  const earthRadiusKm = 6371;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearing = degreesToRadians(bearingDeg);
  const lat1 = degreesToRadians(origin.lat);
  const lng1 = degreesToRadians(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lat: radiansToDegrees(lat2),
    lng: radiansToDegrees(lng2),
  };
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const earthRadiusKm = 6371;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLng = degreesToRadians(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a =
    sinLat * sinLat +
    Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2)) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value) {
  return (value * 180) / Math.PI;
}

function hashValue(input) {
  return [...String(input)].reduce((accumulator, character) => {
    return (accumulator * 31 + character.charCodeAt(0)) >>> 0;
  }, 7);
}

function formatCurrency(value) {
  return `${Math.round(value).toLocaleString("ja-JP")}円`;
}

function formatDistance(value) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}km`;
}

function formatMinutes(value) {
  const rounded = Math.max(1, Math.round(value));
  return `${rounded}分`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "更新時刻不明";
  }

  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function getDateWeight(value) {
  return parseDateInfo(value)?.date.getTime() || 0;
}

function parseDateInfo(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).normalize("NFKC").trim();
  const compactMatch = normalized.match(
    /(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:\s*\([^)]*\))?(?:\s*(\d{1,2}))?/
  );

  if (compactMatch) {
    const date = new Date(
      Number(compactMatch[1]),
      Number(compactMatch[2]) - 1,
      Number(compactMatch[3]),
      Number(compactMatch[4] || 0)
    );

    if (!Number.isNaN(date.getTime())) {
      return {
        date,
        hasHour: compactMatch[4] != null,
      };
    }
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    date,
    hasHour: true,
  };
}

function buildMobileSearchSummary(search) {
  const parts = [
    FUEL_LABELS[search.fuelType],
    `燃費 ${search.efficiency}km/L`,
    `${search.liters}L`,
    `${search.radiusKm}km`,
  ];

  if (search.includeTimeCost) {
    parts.push(`時間ON`);
  }

  return parts.join(" / ");
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 720px)").matches;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
