const STORAGE_KEY = "gasrank-form-v1";
const MAX_RESULTS = 20;
const MAX_VISIBLE_RESULTS = 5;
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
  regular: "\u30ec\u30ae\u30e5\u30e9\u30fc",
  premium: "\u30cf\u30a4\u30aa\u30af",
  diesel: "\u8efd\u6cb9",
};

const PRICE_TYPE_LABELS = {
  cash: "現金",
  member: "会員",
  appMember: "アプリ会員",
};

const OPENING_DAY_ORDER = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const OPENING_DAY_LABELS = {
  Mo: "月曜",
  Tu: "火曜",
  We: "水曜",
  Th: "木曜",
  Fr: "金曜",
  Sa: "土曜",
  Su: "日曜",
  PH: "祝日",
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

const OVERPASS_TIMEOUT_MS = 5500;
const API_BASE = getApiBase();

const state = {
  loading: false,
  loadingMessage: "",
  errorMessage: "",
  location: null,
  locationLabel: "\u672a\u53d6\u5f97",
  results: [],
  lastSearch: null,
  sort: "total",
  dataSource: "idle",
  activeMapStationId: null,
  isSearchPanelCollapsed: false,
  isSearchDialogOpen: false,
  isMapExpanded: true,
  mobileResultsMode: "recommended",
  priceCoverage: {
    actual: 0,
    market: 0,
    estimated: 0,
  },
};

const elements = {
  searchPanel: document.querySelector("#searchPanel"),
  searchLauncher: document.querySelector("#searchLauncher"),
  searchLauncherButton: document.querySelector("#searchLauncherButton"),
  searchForm: document.querySelector("#searchForm"),
  searchPanelBody: document.querySelector("#searchPanelBody"),
  toggleSearchPanelButton: document.querySelector("#toggleSearchPanelButton"),
  searchPanelCloseButton: document.querySelector("#searchPanelCloseButton"),
  searchPanelSummary: document.querySelector("#searchPanelSummary"),
  searchModalBackdrop: document.querySelector("#searchModalBackdrop"),
  locateButton: document.querySelector("#locateButton"),
  searchButton: document.querySelector("#searchButton"),
  validationMessage: document.querySelector("#validationMessage"),
  locationText: document.querySelector("#locationText"),
  recommendedResultPanel: document.querySelector("#recommendedResultPanel"),
  comparisonCarouselPanel: document.querySelector("#comparisonCarouselPanel"),
  resultsList: document.querySelector("#resultsList"),
  resultMapPanel: document.querySelector("#resultMapPanel"),
  sortTabs: document.querySelector("#sortTabs"),
  stationDialog: document.querySelector("#stationDialog"),
  dialogContent: document.querySelector("#dialogContent"),
  mobileMapSheet: document.querySelector("#mobileMapSheet"),
  mobileMapSheetContent: document.querySelector("#mobileMapSheetContent"),
};

init();

function init() {
  state.isMapExpanded = !isMobileViewport();
  hydrateForm();
  bindEvents();
  syncWageInputState();
  renderSearchPanel();
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 960px)").matches;
}

function bindEvents() {
  elements.searchLauncherButton.addEventListener("click", handleLocateClick);
  elements.locateButton.addEventListener("click", handleLocateClick);
  elements.toggleSearchPanelButton.addEventListener("click", toggleSearchPanel);
  elements.searchPanelCloseButton.addEventListener("click", closeSearchDialog);
  elements.searchModalBackdrop.addEventListener("click", closeSearchDialog);
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
  elements.searchPanelSummary.addEventListener("click", handleResultCardClick);
  elements.recommendedResultPanel.addEventListener("click", handleResultCardClick);
  elements.comparisonCarouselPanel.addEventListener("click", handleResultCardClick);
  elements.resultsList.addEventListener("click", handleResultCardClick);
  elements.resultMapPanel.addEventListener("click", handleResultCardClick);
  elements.dialogContent.addEventListener("click", handleDialogClick);
  elements.mobileMapSheet.addEventListener("click", handleMobileMapSheetClick);
  elements.mobileMapSheet.addEventListener("close", handleMobileMapSheetClose);
  elements.stationDialog.addEventListener("click", handleStationDialogBackdropClick);
  document.addEventListener("wheel", handleGlobalWheelScroll, { passive: false, capture: true });
  window.addEventListener("resize", handleViewportChange);
}

function handleGlobalWheelScroll(event) {
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || event.shiftKey) {
    return;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return;
  }

  const modalScope = target.closest(".search-panel.is-modal-open, dialog[open]");
  if (modalScope) {
    return;
  }

  const scrollableAncestor = findVerticalScrollableAncestor(target);
  if (scrollableAncestor && scrollableAncestor !== document.body && scrollableAncestor !== document.documentElement) {
    return;
  }

  const assistZone = target.closest(
    ".panel, .comparison-carousel-track, .comparison-carousel-panel, .sort-tabs, .result-card, .map-panel"
  );
  if (!assistZone) {
    return;
  }

  window.scrollBy({
    top: event.deltaY,
    behavior: "auto",
  });
  event.preventDefault();
}

function findVerticalScrollableAncestor(startElement) {
  let current = startElement;

  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY === "visible" ? style.overflow : style.overflowY;
    const canScrollY = /(auto|scroll|overlay)/.test(overflowY);

    if (canScrollY && current.scrollHeight > current.clientHeight + 1) {
      return current;
    }

    current = current.parentElement;
  }

  return document.scrollingElement || document.documentElement;
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

  if (state.location && !state.isSearchDialogOpen) {
    openSearchDialog();
    return;
  }

  try {
    setLoading(true, "現在地を取得しています…");
    const location = await getCurrentLocation();
    setLocation(location);
    openSearchDialog();
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
    state.mobileResultsMode = "recommended";
    if (isMobileViewport()) {
      state.isSearchPanelCollapsed = true;
      state.isMapExpanded = false;
    }
    state.errorMessage = "";
    closeSearchDialog(true);
  } catch (error) {
    console.error(error);
    state.results = [];
    state.errorMessage = "検索に失敗しました。再度お試しください。";
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
  elements.searchLauncherButton.disabled = loading;
  elements.searchButton.disabled = loading;
  elements.locateButton.disabled = loading;
  elements.toggleSearchPanelButton.disabled = loading;
  elements.searchPanelCloseButton.disabled = loading;
  elements.searchLauncherButton.textContent = loading ? "取得中…" : "現在地を取得";
  elements.searchButton.classList.toggle("is-loading", loading);
  elements.searchButton.setAttribute("aria-busy", loading ? "true" : "false");
  elements.searchButton.innerHTML = loading
    ? `<span class="button-loading"><span class="button-loading-spinner" aria-hidden="true"></span><span>10秒ほどお待ちください。</span></span>`
    : "\u691c\u7d22";
  renderSearchPanel();
  renderResults();
}

function handleViewportChange() {
  if (isMobileViewport()) {
    state.isMapExpanded = false;
    if (!state.results.length) {
      state.mobileResultsMode = "recommended";
    }
  } else {
    state.isMapExpanded = true;
    if (state.results.length) {
      state.mobileResultsMode = "list";
    }
    closeMobileMapSheet();
  }

  renderSearchPanel();
  renderResults();
}

function toggleSearchPanel() {
  if (state.isSearchDialogOpen) {
    closeSearchDialog();
  } else {
    openSearchDialog();
  }
  renderSearchPanel();
}

function renderSearchPanel() {
  const hasSearchSummary = !!state.lastSearch;
  const showSummary = !state.isSearchDialogOpen && hasSearchSummary;
  const hasLocation = !!state.location;
  const isInitialLauncher = !state.isSearchDialogOpen && !hasLocation && !hasSearchSummary;

  elements.searchPanel.classList.toggle("is-modal-open", state.isSearchDialogOpen);
  elements.searchPanel.classList.toggle("is-compact", !state.isSearchDialogOpen);
  elements.searchPanel.classList.toggle("is-initial-launcher", isInitialLauncher);
  elements.searchLauncher.hidden = !isInitialLauncher;
  elements.searchPanelBody.hidden = !state.isSearchDialogOpen;
  elements.searchModalBackdrop.classList.toggle("active", state.isSearchDialogOpen);
  elements.toggleSearchPanelButton.hidden = true;
  elements.searchPanelCloseButton.hidden = !state.isSearchDialogOpen;
  elements.locateButton.textContent = hasLocation && !state.isSearchDialogOpen ? "条件を開く" : "現在地を取得";
  elements.locateButton.classList.toggle("open-button", hasLocation && !state.isSearchDialogOpen);

  if (!showSummary) {
    elements.searchPanelSummary.innerHTML = "";
    return;
  }

  elements.searchPanelSummary.innerHTML = `
    <div class="mobile-summary-row">
      <p class="mobile-summary-text">${escapeHtml(buildMobileSearchSummary(state.lastSearch))}</p>
      <button type="button" class="ghost-button summary-edit-button" data-open-search-panel="true">条件変更</button>
    </div>
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
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort("overpass_timeout"), OVERPASS_TIMEOUT_MS);

  let payload = null;

  try {
    const baseUrl = API_BASE ? `${API_BASE}/api/overpass` : "/api/overpass";
    const response = await fetch(
      `${baseUrl}?lat=${encodeURIComponent(location.lat)}&lng=${encodeURIComponent(
        location.lng
      )}&radiusKm=${encodeURIComponent(radiusKm)}`,
      {
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      throw new Error(`overpass_proxy_status_${response.status}`);
    }

    payload = await response.json();
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("overpass lookup failed", error);
    }
  } finally {
    clearTimeout(timeoutId);
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
    const baseUrl = API_BASE ? `${API_BASE}/api/prices` : "/api/prices";
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

function getApiBase() {
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
      const match = scorePriceMatch(station, shop);
      if (match.accepted) {
        candidates.push({
          stationId: station.id,
          shopId: shop.shopId,
          shop,
          score: match.score,
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

function openSearchDialog() {
  state.isSearchDialogOpen = true;
  renderSearchPanel();
}

function closeSearchDialog(force = false) {
  if (state.loading && !force) {
    return;
  }

  state.isSearchDialogOpen = false;
  renderSearchPanel();
}

function scorePriceMatch(station, shop) {
  const stationName = normalizeMatchText(station.name);
  const stationExtendedName = normalizeMatchText(
    `${station.brandLabel || ""} ${station.operator || ""} ${station.name || ""}`
  );
  const shopName = normalizeMatchText(shop.name);
  const stationAddress = normalizeAddressText(station.address);
  const shopAddress = normalizeAddressText(shop.address);
  const stationAddressTail = extractAddressTail(stationAddress);
  const shopAddressTail = extractAddressTail(shopAddress);
  const stationCombined = `${stationExtendedName}${stationAddressTail}`;
  const shopCombined = `${shopName}${shopAddressTail}`;

  const primaryNameSimilarity = compareMatchText(stationName, shopName);
  const extendedNameSimilarity = compareMatchText(stationExtendedName, shopName);
  const nameSimilarity = Math.max(primaryNameSimilarity, extendedNameSimilarity);
  const addressSimilarity = compareMatchText(stationAddress, shopAddress);
  const addressTailSimilarity = compareMatchText(stationAddressTail, shopAddressTail);
  const combinedSimilarity = compareMatchText(stationCombined, shopCombined);
  const stationAddressTokens = extractNumericTokens(stationAddress);
  const shopAddressTokens = extractNumericTokens(shopAddress);
  const stationBrand = normalizeBrandText(`${station.brand || ""} ${station.brandLabel || ""} ${station.operator || ""}`);
  const shopBrand = normalizeBrandText(shop.name);
  const brandBonus =
    stationBrand && stationBrand === shopBrand ? 0.12 : 0;
  const brandPenalty =
    stationBrand && shopBrand && stationBrand !== shopBrand ? 0.16 : 0;
  const addressNumberBonus = overlappingTokenRatio(stationAddressTokens, shopAddressTokens);
  const addressSequenceBonus = hasMatchingTrailingAddressSequence(stationAddressTokens, shopAddressTokens) ? 0.12 : 0;
  const genericStationName = isGenericMatchName(stationName);
  const genericShopName = isGenericMatchName(shopName);

  if (brandPenalty && addressTailSimilarity < 0.42 && addressNumberBonus === 0) {
    return { score: 0, accepted: false };
  }

  if (stationAddressTokens.length && shopAddressTokens.length && addressNumberBonus === 0 && addressTailSimilarity < 0.34) {
    return { score: 0, accepted: false };
  }

  if (
    genericStationName &&
    genericShopName &&
    (addressTailSimilarity < 0.55 || addressNumberBonus < 0.5)
  ) {
    return { score: 0, accepted: false };
  }

  if (nameSimilarity < 0.18 && addressSimilarity < 0.14 && addressTailSimilarity < 0.24) {
    return { score: 0, accepted: false };
  }

  let score =
    nameSimilarity * 0.34 +
    addressSimilarity * 0.12 +
    addressTailSimilarity * 0.22 +
    combinedSimilarity * 0.12 +
    addressNumberBonus * 0.14 +
    addressSequenceBonus +
    brandBonus -
    brandPenalty;

  if (
    stationName &&
    shopName &&
    (stationName === shopName || stationName.includes(shopName) || shopName.includes(stationName))
  ) {
    score += 0.12;
  }

  if (addressTailSimilarity >= 0.86) {
    score += 0.08;
  }

  if (addressNumberBonus >= 0.5) {
    score += 0.06;
  }

  if (genericStationName && addressNumberBonus === 0 && addressTailSimilarity < 0.45) {
    score -= 0.14;
  }

  const normalizedScore = Math.max(0, Math.min(score, 1));
  const accepted =
    normalizedScore >= 0.42 ||
    (normalizedScore >= 0.36 &&
      addressNumberBonus >= 0.5 &&
      (brandBonus > 0 || addressTailSimilarity >= 0.72 || !genericShopName));

  return {
    score: normalizedScore,
    accepted,
  };
}

function extractNumericTokens(value) {
  return String(value || "").match(/\d+/g) || [];
}

function overlappingTokenRatio(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) {
    return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let overlap = 0;

  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }

  if (Math.min(leftSet.size, rightSet.size) >= 2 && overlap < 2) {
    return 0;
  }

  return overlap / Math.max(leftSet.size, rightSet.size, 1);
}

function hasMatchingTrailingAddressSequence(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) {
    return false;
  }

  const maxLength = Math.min(3, leftTokens.length, rightTokens.length);
  const minLength = maxLength >= 2 ? 2 : 1;
  for (let length = maxLength; length >= minLength; length -= 1) {
    if (leftTokens.slice(-length).join("-") === rightTokens.slice(-length).join("-")) {
      return true;
    }
  }

  return false;
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
    .replace(/[（(][^()（）]*[)）]/g, " ")
    .replace(/名称未登録スタンド|要確認/g, " ")
    .replace(/アポロステーション|apollo\s*station|apollo/g, "apollostation")
    .replace(/出光/g, "idemitsu")
    .replace(/エネオス|enejet/g, "eneos")
    .replace(/コスモ/g, "cosmo")
    .replace(/シェル/g, "shell")
    .replace(/全農|農協/g, "ja")
    .replace(/株式会社|有限会社|合同会社|co\.?\s*,?\s*ltd\.?|ltd\.?|inc\.?|corp\.?/g, " ")
    .replace(/サービスステーション|ガソリンスタンド|給油所|ドクタードライブ|dr\.?\s*drive|enejet|エクスプレス|express/g, " ")
    .replace(/\bss\b|ｓｓ|セルフ|self|フルサービス/g, " ")
    .replace(/[\/・･]/g, " ")
    .replace(/\s+/g, "")
    .replace(/[^\w\u3040-\u30ff\u3400-\u9fff]+/g, "")
    .trim();
}

function normalizeAddressText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/住所情報なし|要確認/g, "")
    .replace(/[（(][^()（）]*[)）]/g, "")
    .replace(/大字|字/g, "")
    .replace(/丁目|番地|番|地割/g, "-")
    .replace(/[号地]/g, "")
    .replace(/[‐‑‒–—―ーｰ−]/g, "-")
    .replace(/\d+f\b/g, "")
    .replace(/[^\w\u3040-\u30ff\u3400-\u9fff-]+/g, "")
    .replace(/-+/g, "-")
    .trim();
}

function normalizeBrandText(value) {
  const text = normalizeMatchText(value);

  if (text.includes("eneos")) return "eneos";
  if (text.includes("apollostation") || text.includes("apollo") || text.includes("idemitsu")) return "apollostation";
  if (text.includes("cosmo")) return "cosmo";
  if (text.includes("shell")) return "shell";
  if (text === "ja" || text.includes("ja")) return "ja";

  return "";
}

function extractAddressTail(value) {
  const normalized = normalizeAddressText(value);
  if (!normalized) {
    return "";
  }

  const firstDigitIndex = normalized.search(/\d/);
  if (firstDigitIndex >= 0) {
    return normalized.slice(Math.max(0, firstDigitIndex - 6));
  }

  return normalized.slice(-12);
}

function isGenericMatchName(value) {
  const stripped = String(value || "")
    .replace(/eneos|idemitsu|apollostation|cosmo|shell|ja/g, "")
    .replace(/self|セルフ|ss|drdrive|enejet|express/g, "")
    .trim();

  return stripped.length < 4;
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
  const operator = normalizeDisplayText(tags.operator);
  const rawBrand = normalizeDisplayText(tags.brand);
  const inferredBrand = rawBrand || guessBrand(tags.name || "") || "";
  const openingHoursRaw = normalizeDisplayText(tags.opening_hours);
  const livePrices = parseLivePrices(tags);
  const geoDistanceKm = haversineKm(userLocation.lat, userLocation.lng, lat, lng);

  return {
    id: `${element.type}-${element.id}`,
    name: normalizeDisplayText(tags.name) || inferredBrand || "名称未登録スタンド",
    brand: inferredBrand || "要確認",
    brandLabel: rawBrand || operator || inferredBrand || "要確認",
    operator: operator || "要確認",
    address: buildAddress(tags),
    lat,
    lng,
    geoDistanceKm,
    openStatus: deriveOpenStatus(tags),
    openingHoursRaw,
    openingHoursLabel: formatOpeningHoursLabel(openingHoursRaw),
    closedDaysLabel: deriveClosedDays(openingHoursRaw),
    serviceMode: deriveServiceMode(tags),
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

function normalizeDisplayText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function buildAddress(tags) {
  const joined = [
    normalizeDisplayText(tags["addr:province"]),
    normalizeDisplayText(tags["addr:city"]),
    normalizeDisplayText(tags["addr:suburb"]),
    normalizeDisplayText(tags["addr:street"]),
    normalizeDisplayText(tags["addr:housenumber"]),
  ]
    .filter(Boolean)
    .join("");

  if (joined) {
    return joined;
  }

  return normalizeDisplayText(tags["addr:full"]) || normalizeDisplayText(tags.address) || "住所情報なし";
}

function deriveOpenStatus(tags) {
  const openingHours = normalizeDisplayText(tags.opening_hours);

  if (openingHours === "24/7") {
    return "24時間営業";
  }
  if (openingHours) {
    return "営業時間あり";
  }
  return "営業時間要確認";
}

function formatOpeningHoursLabel(openingHoursRaw) {
  if (!openingHoursRaw) {
    return "営業時間情報なし";
  }

  return openingHoursRaw === "24/7" ? "24時間営業" : openingHoursRaw;
}

function deriveClosedDays(openingHoursRaw) {
  if (!openingHoursRaw) {
    return "要確認";
  }

  if (openingHoursRaw === "24/7" || /\bMo-Su\b/i.test(openingHoursRaw)) {
    return "なし";
  }

  const days = [];
  const clauses = openingHoursRaw.split(/\s*;\s*/).filter(Boolean);

  for (const clause of clauses) {
    if (!/\b(?:off|closed)\b/i.test(clause)) {
      continue;
    }

    const matches = clause.match(/\b(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?\b/g) || [];
    for (const match of matches) {
      for (const day of expandOpeningDayRange(match)) {
        if (!days.includes(day)) {
          days.push(day);
        }
      }
    }
  }

  if (!days.length) {
    return "要確認";
  }

  return days.map((day) => OPENING_DAY_LABELS[day] || day).join("・");
}

function expandOpeningDayRange(token) {
  if (token === "PH") {
    return ["PH"];
  }

  if (!token.includes("-")) {
    return [token];
  }

  const [start, end] = token.split("-");
  const startIndex = OPENING_DAY_ORDER.indexOf(start);
  const endIndex = OPENING_DAY_ORDER.indexOf(end);

  if (startIndex === -1 || endIndex === -1) {
    return [];
  }

  if (startIndex <= endIndex) {
    return OPENING_DAY_ORDER.slice(startIndex, endIndex + 1);
  }

  return [...OPENING_DAY_ORDER.slice(startIndex), ...OPENING_DAY_ORDER.slice(0, endIndex + 1)];
}

function deriveServiceMode(tags) {
  const directValue = normalizeDisplayText(tags.self_service || tags.self || tags.service || tags.attended);
  const normalizedValue = directValue.toLowerCase();
  const normalizedName = normalizeDisplayText(tags.name).toLowerCase();

  if (
    normalizedValue === "yes" ||
    normalizedValue === "true" ||
    normalizedValue === "1" ||
    normalizedValue.includes("self") ||
    normalizedValue.includes("セルフ") ||
    normalizedName.includes("セルフ")
  ) {
    return "セルフ";
  }

  if (
    normalizedValue === "no" ||
    normalizedValue === "false" ||
    normalizedValue === "0" ||
    normalizedValue.includes("full") ||
    normalizedValue.includes("staff") ||
    normalizedValue.includes("フルサービス") ||
    normalizedName.includes("フルサービス")
  ) {
    return "スタッフ対応";
  }

  return "要確認";
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
      priceSourceLabel: "現地価格",
      isEstimatedPrice: false,
      updatedLabel: station.rawUpdatedAt ? formatDate(station.rawUpdatedAt) : "更新時刻不明",
      updatedAtWeight: station.rawUpdatedAt ? Date.parse(station.rawUpdatedAt) || 0 : 0,
      priceSourceKind: "actual",
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
      convertPriceByType(sourcePrice, sourceType, targetPriceType),
      sourceType === targetPriceType ? exactLabel : adjustedLabel,
      sourceType === targetPriceType ? "actual" : "market",
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
    updatedLabel: updatedAtRaw ? formatKnownDate(updatedAtRaw) : "更新時刻不明",
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
  if (state.loading) {
    elements.recommendedResultPanel.innerHTML = "";
    elements.comparisonCarouselPanel.innerHTML = "";
    elements.resultsList.classList.remove("is-mobile-list-hidden");
    elements.resultsList.innerHTML = renderLoadingCard();
    elements.resultMapPanel.innerHTML = "";
    closeMobileMapSheet();
    return;
  }

  if (state.errorMessage) {
    elements.recommendedResultPanel.innerHTML = "";
    elements.comparisonCarouselPanel.innerHTML = "";
    elements.resultsList.classList.remove("is-mobile-list-hidden");
    elements.resultsList.innerHTML = `
      <article class="empty-card">
        <h3>検索に失敗しました</h3>
        <p>${escapeHtml(state.errorMessage)}</p>
      </article>
    `;
    elements.resultMapPanel.innerHTML = "";
    closeMobileMapSheet();
    return;
  }

  if (!state.results.length) {
    elements.recommendedResultPanel.innerHTML = "";
    elements.comparisonCarouselPanel.innerHTML = "";
    elements.resultsList.classList.remove("is-mobile-list-hidden");
    elements.resultsList.innerHTML = `
      <article class="empty-card">
        <h3>未検索</h3>
        <p>現在地と条件を入れて検索してください。</p>
      </article>
    `;
    elements.resultMapPanel.innerHTML = "";
    closeMobileMapSheet();
    return;
  }

  const visibleResults = getVisibleResults();
  const detailMode = state.lastSearch?.detailMode || "simple";
  const showMobileCarousel = isMobileViewport() && visibleResults.length;

  elements.recommendedResultPanel.innerHTML = "";

  elements.comparisonCarouselPanel.innerHTML = showMobileCarousel
    ? renderComparisonCarousel(visibleResults, detailMode)
    : "";

  if (isMobileViewport()) {
    elements.resultsList.classList.toggle("is-mobile-list-hidden", true);
    elements.resultsList.innerHTML = "";
  } else {
    elements.resultsList.classList.remove("is-mobile-list-hidden");
    elements.resultsList.innerHTML = visibleResults
      .map((station, index) =>
        renderResultCard(station, index + 1, detailMode, {
          compact: false,
          hidden: false,
        })
      )
      .join("");
  }

  renderMapPanel(visibleResults);
}

function renderComparisonCarousel(stations, detailMode) {
  return `
    <section class="comparison-carousel-panel">
      <div class="comparison-carousel-head">
        <strong>比較</strong>
      </div>
      <div class="comparison-carousel-frame">
        <span class="comparison-edge-arrow comparison-edge-arrow-left" aria-hidden="true">←</span>
        <div class="comparison-carousel-track" aria-label="比較結果一覧">
          ${stations
            .map((station, index) =>
              renderResultCard(station, index + 1, detailMode, {
                compact: true,
                hidden: false,
              })
            )
            .join("")}
        </div>
        <span class="comparison-edge-arrow comparison-edge-arrow-right" aria-hidden="true">→</span>
      </div>
    </section>
  `;
}
function renderMapPanel(visibleResults = getVisibleResults()) {
  if (!state.lastSearch || !visibleResults.length) {
    elements.resultMapPanel.innerHTML = "";
    return;
  }

  const activeStation =
    visibleResults.find((station) => station.id === state.activeMapStationId) || visibleResults[0];

  if (!activeStation) {
    elements.resultMapPanel.innerHTML = "";
    return;
  }

  const appleMapsUrl = buildAppleMapsUrl(activeStation);
  const googleMapsUrl = buildGoogleMapsUrl(activeStation);
  const mapEmbedUrl = buildMapEmbedUrl(activeStation);

  if (isMobileViewport()) {
    elements.resultMapPanel.innerHTML = "";
    if (state.mobileResultsMode === "map-sheet") {
      openMobileMapSheet(activeStation, mapEmbedUrl, appleMapsUrl, googleMapsUrl);
    } else {
      closeMobileMapSheet();
    }
    return;
  }

  closeMobileMapSheet();

  elements.resultMapPanel.innerHTML = `
    <section class="map-panel">
      <div class="map-panel-head">
        <div class="map-panel-copy">
          <strong>${escapeHtml(activeStation.name)} の地図</strong>
          <p>${escapeHtml(activeStation.address)}</p>
        </div>
        <div class="map-panel-controls">
          <span class="card-badge badge-muted">${formatDistance(activeStation.distanceKm)} / ${formatMinutes(
            activeStation.durationMinutes
          )}</span>
          ${
            isMobileViewport()
              ? `<button type="button" class="detail-button secondary" data-toggle-map-panel="true">${
                  state.isMapExpanded ? "閉じる" : "地図"
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
          Appleマップ
        </a>
        <a class="map-button map-button-secondary" href="${escapeHtml(googleMapsUrl)}" target="_blank" rel="noreferrer">
          Googleマップ
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

function getVisibleResults() {
  return sortResults(state.results, state.sort).slice(0, MAX_VISIBLE_RESULTS);
}

function renderResultCard(station, displayRank, detailMode, options = {}) {
  const compact = options.compact;
  const hidden = options.hidden;
  const detailSection =
    detailMode === "detailed" && !compact
      ? `
        <div class="result-detail">
          ${renderDetailRows(station)}
        </div>
      `
      : "";

  return `
    <article class="result-card ${displayRank === 1 ? "top-ranked" : ""} ${compact ? "result-card-compact" : ""} ${
      hidden ? "result-card-hidden-mobile" : ""
    }">
      <div class="card-header">
        <div class="rank-block">
          <div class="rank-badge">#${displayRank}</div>
          <div>
            <h3>${escapeHtml(station.name)}</h3>
            <div class="station-subline">
              <span class="card-badge ${station.openStatus === "24時間営業" ? "badge-open" : "badge-muted"}">
                ${escapeHtml(station.openStatus)}
              </span>
              <span class="card-badge badge-muted">ブランド ${escapeHtml(station.brandLabel)}</span>
              <span class="card-badge badge-muted">${escapeHtml(station.serviceMode)}</span>
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
          <span class="metric-label">価格更新時刻</span>
          <span class="metric-value">${escapeHtml(station.updatedLabel)}</span>
        </div>
      </div>

      <p class="result-note">${escapeHtml(compact ? station.recommendation : station.reason)}</p>
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
            詳細を見る
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
    <div class="detail-row"><span>移動で消費する燃料量</span><strong>${station.driveFuelLiters.toFixed(2)}L</strong></div>
  `;
}

function handleResultCardClick(event) {
  const openSearchPanelTrigger = event.target.closest("[data-open-search-panel]");
  if (openSearchPanelTrigger) {
    openSearchDialog();
    return;
  }

  const mapPanelToggle = event.target.closest("[data-toggle-map-panel]");
  if (mapPanelToggle) {
    state.isMapExpanded = !state.isMapExpanded;
    renderMapPanel();
    return;
  }

  const mapTrigger = event.target.closest("[data-map-station-id]");
  if (mapTrigger) {
    state.activeMapStationId = mapTrigger.dataset.mapStationId;
    if (isMobileViewport()) {
      state.mobileResultsMode = "map-sheet";
    } else {
      state.isMapExpanded = true;
    }
    renderMapPanel();
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
  if (!isMobileViewport()) {
    state.isMapExpanded = true;
    renderMapPanel();
  }
  renderDialog(station);
}

function handleMobileMapSheetClick(event) {
  const closeTrigger = event.target.closest("[data-close-mobile-map]");
  if (!closeTrigger) {
    return;
  }

  closeMobileMapSheet();
  if (state.results.length) {
    state.mobileResultsMode = "recommended";
    renderResults();
  }
}

function handleMobileMapSheetClose() {
  if (!isMobileViewport()) {
    return;
  }

  if (state.mobileResultsMode === "map-sheet") {
    state.mobileResultsMode = "recommended";
    renderResults();
  }
}

function handleDialogClick(event) {
  const closeTrigger = event.target.closest("[data-close-station-dialog]");
  if (!closeTrigger) {
    return;
  }

  if (elements.stationDialog.open) {
    elements.stationDialog.close();
  }
}

function handleStationDialogBackdropClick(event) {
  if (event.target !== elements.stationDialog) {
    return;
  }

  elements.stationDialog.close();
}

function renderDialog(station) {
  elements.dialogContent.innerHTML = `
    <div class="dialog-content">
      <div class="dialog-title-row">
        <div>
          <p class="section-kicker">Detail</p>
          <h3>${escapeHtml(station.name)}</h3>
        </div>
        <div class="dialog-head-actions">
          <div class="cost-block">
            <p class="cost-label">実質総コスト</p>
            <p class="cost-total">${formatCurrency(station.totalCost)}</p>
          </div>
          <button type="button" class="ghost-button dialog-close-button" data-close-station-dialog="true">閉じる</button>
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
          Appleマップ
        </a>
        <a class="map-button map-button-secondary" href="${escapeHtml(
          buildGoogleMapsUrl(station)
        )}" target="_blank" rel="noreferrer">
          Googleマップ
        </a>
      </div>

      <div class="result-detail">
        <div class="detail-row"><span>営業状況</span><strong>${escapeHtml(station.openStatus)}</strong></div>
        <div class="detail-row"><span>ブランド</span><strong>${escapeHtml(station.brandLabel)}</strong></div>
        <div class="detail-row"><span>運営会社</span><strong>${escapeHtml(station.operator)}</strong></div>
        <div class="detail-row"><span>給油方式</span><strong>${escapeHtml(station.serviceMode)}</strong></div>
        <div class="detail-row"><span>営業時間</span><strong>${escapeHtml(station.openingHoursLabel)}</strong></div>
        <div class="detail-row"><span>休業日</span><strong>${escapeHtml(station.closedDaysLabel)}</strong></div>
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

function openMobileMapSheet(station, mapEmbedUrl, appleMapsUrl, googleMapsUrl) {
  elements.mobileMapSheetContent.innerHTML = `
    <div class="mobile-map-sheet-inner">
      <div class="mobile-map-sheet-grabber" aria-hidden="true"></div>
      <div class="mobile-map-sheet-head">
        <div>
          <p class="section-kicker">Map</p>
          <h3>${escapeHtml(station.name)}</h3>
          <p class="mobile-map-sheet-address">${escapeHtml(station.address)}</p>
        </div>
        <button type="button" class="ghost-button mobile-map-close" data-close-mobile-map="true">閉じる</button>
      </div>
      <div class="mobile-map-sheet-meta">
        <span class="card-badge badge-muted">${formatDistance(station.distanceKm)}</span>
        <span class="card-badge badge-muted">${formatMinutes(station.durationMinutes)}</span>
        <span class="card-badge badge-muted">${formatCurrency(station.totalCost)}</span>
      </div>
      <iframe
        class="map-frame mobile-map-frame"
        title="${escapeHtml(station.name)} の地図"
        src="${escapeHtml(mapEmbedUrl)}"
        loading="lazy"
        referrerpolicy="no-referrer-when-downgrade"
      ></iframe>
      <div class="map-actions mobile-map-actions">
        <a class="map-button map-button-primary" href="${escapeHtml(appleMapsUrl)}" target="_blank" rel="noreferrer">
          Appleマップ
        </a>
        <a class="map-button map-button-secondary" href="${escapeHtml(googleMapsUrl)}" target="_blank" rel="noreferrer">
          Googleマップ
        </a>
      </div>
    </div>
  `;

  if (typeof elements.mobileMapSheet.showModal === "function") {
    if (!elements.mobileMapSheet.open) {
      elements.mobileMapSheet.showModal();
    }
  }
}

function closeMobileMapSheet() {
  if (elements.mobileMapSheet.open) {
    elements.mobileMapSheet.close();
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
      brandLabel: seed.brand,
      operator: "要確認",
      address: "周辺価格 API 未接続時のデモ候補",
      lat: coords.lat,
      lng: coords.lng,
      geoDistanceKm: seed.km,
      openStatus: "営業時間要確認",
      openingHoursRaw: "",
      openingHoursLabel: "営業時間情報なし",
      closedDaysLabel: "要確認",
      serviceMode: seed.name.includes("セルフ") ? "セルフ" : "要確認",
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

function formatDistance(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return value < 1 ? `${Math.round(value * 1000)}m` : `${value.toFixed(1)}km`;
}

function formatMinutes(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const rounded = Math.max(0, Math.round(value));
  if (rounded < 60) {
    return `${rounded}分`;
  }

  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return minutes === 0 ? `${hours}時間` : `${hours}時間${minutes}分`;
}

function formatCurrency(value) {
  return `${Math.round(value).toLocaleString("ja-JP")}\u5186`;
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
    `${search.liters}L`,
    `${search.radiusKm}km`,
  ];

  if (search.includeTimeCost) {
    parts.push("時間ON");
  }

  return parts.join(" / ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
