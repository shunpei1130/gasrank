const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 4173);
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const cache = new Map();
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

const FUEL_MODES = {
  regular: 0,
  premium: 1,
  diesel: 2,
};

const FUEL_LABEL_MAP = {
  "\u30ec\u30ae\u30e5\u30e9\u30fc": "regular",
  "\u30cf\u30a4\u30aa\u30af": "premium",
  "\u8efd\u6cb9": "diesel",
};

const server = http.createServer(async (request, response) => {
  try {
    const baseUrl = `http://${request.headers.host || `localhost:${PORT}`}`;
    const requestUrl = new URL(request.url || "/", baseUrl);

    if (requestUrl.pathname === "/api/prices") {
      await handlePriceApi(requestUrl, response);
      return;
    }

    if (requestUrl.pathname === "/api/overpass") {
      await handleOverpassApi(requestUrl, response);
      return;
    }

    serveStaticFile(requestUrl.pathname, response);
  } catch (error) {
    console.error("server request failed", error);
    sendJson(response, 500, {
      error: "internal_server_error",
      message: "\u30b5\u30fc\u30d0\u30fc\u51e6\u7406\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002",
    });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`GasRank server running at http://localhost:${PORT}`);
  });
}

module.exports = {
  server,
  getMunicipalityPricePayload,
  getOverpassPayload,
  parseRankingHtml,
  parseCityAverages,
  cleanHtmlText,
  readTextResponse,
};

async function handlePriceApi(requestUrl, response) {
  const lat = Number(requestUrl.searchParams.get("lat"));
  const lng = Number(requestUrl.searchParams.get("lng"));
  const fuelType = requestUrl.searchParams.get("fuelType") || "regular";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    sendJson(response, 400, {
      error: "invalid_coordinates",
      message: "\u73fe\u5728\u5730\u306e\u5ea7\u6a19\u304c\u4e0d\u6b63\u3067\u3059\u3002",
    });
    return;
  }

  if (!(fuelType in FUEL_MODES)) {
    sendJson(response, 400, {
      error: "invalid_fuel_type",
      message: "\u6cb9\u7a2e\u304c\u4e0d\u6b63\u3067\u3059\u3002",
    });
    return;
  }

  try {
    const payload = await getMunicipalityPricePayload({ lat, lng, fuelType });
    sendJson(response, 200, payload);
  } catch (error) {
    console.error("price api failed", error);
    sendJson(response, 502, {
      error: "price_lookup_failed",
      message: "\u5730\u57df\u4fa1\u683c\u306e\u53d6\u5f97\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002",
    });
  }
}

async function handleOverpassApi(requestUrl, response) {
  const lat = Number(requestUrl.searchParams.get("lat"));
  const lng = Number(requestUrl.searchParams.get("lng"));
  const radiusKm = Number(requestUrl.searchParams.get("radiusKm") || "5");

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    sendJson(response, 400, {
      error: "invalid_coordinates",
      message: "現在地の座標が不正です。",
    });
    return;
  }

  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 30) {
    sendJson(response, 400, {
      error: "invalid_radius",
      message: "検索半径が不正です。",
    });
    return;
  }

  try {
    const payload = await getOverpassPayload({ lat, lng, radiusKm });
    sendJson(response, 200, payload);
  } catch (error) {
    console.error("overpass api failed", error);
    sendJson(response, 502, {
      error: "overpass_lookup_failed",
      message: "周辺スタンド情報の取得に失敗しました。",
    });
  }
}

function serveStaticFile(urlPath, response) {
  const decodedPath = decodeURIComponent(urlPath || "/");
  const normalizedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const relativePath = normalizedPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT_DIR, relativePath);

  if (!filePath.startsWith(ROOT_DIR)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  });
}

async function getMunicipalityPricePayload({ lat, lng, fuelType }) {
  const reverse = await fetchJsonWithCache(
    `gsi:${lat.toFixed(4)}:${lng.toFixed(4)}`,
    `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`
  );

  const muniCd = reverse?.results?.muniCd;
  if (!muniCd) {
    throw new Error("municipality_code_not_found");
  }

  const prefCode = muniCd.slice(0, 2);
  const mode = FUEL_MODES[fuelType];

  const [cityHtml, rankingHtml] = await Promise.all([
    fetchTextWithCache(`gogo-city:${muniCd}`, `https://gogo.gs/${muniCd}`),
    fetchTextWithCache(
      `gogo-ranking:${muniCd}:${fuelType}`,
      `https://gogo.gs/ranking/${prefCode}?city%5B%5D=${muniCd}&submit=1&span=1&mode=${mode}`
    ),
  ]);

  return {
    muniCd,
    prefCode,
    fuelType,
    averages: parseCityAverages(cityHtml),
    averageUpdatedAt: parseAverageUpdatedAt(cityHtml),
    shops: parseRankingHtml(rankingHtml),
    fetchedAt: new Date().toISOString(),
  };
}

async function getOverpassPayload({ lat, lng, radiusKm }) {
  const radiusMeters = Math.round(radiusKm * 1000);
  const query = `
[out:json][timeout:8];
(
  node["amenity"="fuel"](around:${radiusMeters},${lat},${lng});
  way["amenity"="fuel"](around:${radiusMeters},${lat},${lng});
  relation["amenity"="fuel"](around:${radiusMeters},${lat},${lng});
);
out center tags;
`.trim();

  const cacheKey = `overpass:${lat.toFixed(4)}:${lng.toFixed(4)}:${radiusMeters}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetchWithTimeout(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({ data: query }),
      });
      const payload = await response.json();
      cacheSet(cacheKey, payload);
      return payload;
    } catch (error) {
      lastError = error;
      console.warn("overpass upstream failed", endpoint, error?.message || error);
    }
  }

  throw lastError || new Error("overpass_lookup_failed");
}

async function fetchJsonWithCache(cacheKey, url) {
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const payload = await fetchJson(url);
  cacheSet(cacheKey, payload);
  return payload;
}

async function fetchTextWithCache(cacheKey, url) {
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const text = await fetchText(url);
  cacheSet(cacheKey, text);
  return text;
}

function cacheSet(cacheKey, value) {
  cache.set(cacheKey, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  });
}

function cacheGet(cacheKey) {
  const cached = cache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt < Date.now()) {
    cache.delete(cacheKey);
    return null;
  }

  return cached.value;
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(url);
  return response.json();
}

async function fetchText(url) {
  const response = await fetchWithTimeout(url);
  return readTextResponse(response);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("request_timeout"), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.7",
        "User-Agent": "GasRankLocal/1.0 (+http://localhost)",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`upstream_status_${response.status}`);
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readTextResponse(response) {
  const buffer = Buffer.from(await response.arrayBuffer());
  const charset = detectCharset(response.headers.get("content-type"), buffer);
  return decodeBuffer(buffer, charset);
}

function detectCharset(contentType, buffer) {
  const headerCharset = contentType?.match(/charset=([^;]+)/i)?.[1];
  if (headerCharset) {
    return normalizeCharset(headerCharset);
  }

  const preview = buffer.subarray(0, 4096).toString("ascii");
  const metaCharset = preview.match(/<meta[^>]+charset=["']?\s*([a-zA-Z0-9._-]+)/i)?.[1];
  if (metaCharset) {
    return normalizeCharset(metaCharset);
  }

  return "utf-8";
}

function normalizeCharset(charset) {
  const normalized = String(charset).trim().toLowerCase();

  if (normalized === "utf8") return "utf-8";
  if (normalized === "shift-jis") return "shift_jis";
  if (normalized === "shift_jis") return "shift_jis";
  if (normalized === "sjis") return "shift_jis";
  if (normalized === "cp932") return "shift_jis";
  if (normalized === "x-sjis") return "shift_jis";
  if (normalized === "eucjp") return "euc-jp";
  if (normalized === "euc-jp") return "euc-jp";
  if (normalized === "iso-2022-jp") return "iso-2022-jp";

  return normalized;
}

function decodeBuffer(buffer, charset) {
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch (error) {
    console.warn("text decode failed, falling back to utf-8", charset, error?.message || error);
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function parseCityAverages(html) {
  const averages = {
    regular: null,
    premium: null,
    diesel: null,
  };

  const pattern = /<label>([^<]+)<\/label>\s*<div class="price">([\d.,]+)<\/div>/g;

  for (const match of html.matchAll(pattern)) {
    const label = cleanHtmlText(match[1]);
    const fuelType = FUEL_LABEL_MAP[label];
    if (!fuelType) {
      continue;
    }

    averages[fuelType] = parseNumericPrice(match[2]);
  }

  return averages;
}

function parseAverageUpdatedAt(html) {
  const match = html.match(/<span class="help">\s*([^<]+)<\/span>/);
  return match ? cleanHtmlText(match[1]) : "";
}

function parseRankingHtml(html) {
  const rowPattern =
    /<td class="price-td" rowspan="2">\s*<div class="price">([\d.,]+)<\/div>\s*<div class="(normal|member)-text">[\s\S]*?<\/div>[\s\S]*?<a href="\/shop\/(\d+)" class="shop-name">([\s\S]*?)<\/a>\s*<p class="address">([\s\S]*?)<\/p>[\s\S]*?<p class="confirm-date"[^>]*>\s*([\s\S]*?)<br \/>/g;

  const grouped = new Map();

  for (const match of html.matchAll(rowPattern)) {
    const price = parseNumericPrice(match[1]);
    const priceType = match[2] === "member" ? "member" : "cash";
    const shopId = match[3];
    const name = cleanHtmlText(match[4]);
    const address = cleanHtmlText(match[5]);
    const confirmedAt = cleanHtmlText(match[6]);

    if (!Number.isFinite(price) || !shopId || !name) {
      continue;
    }

    const existing = grouped.get(shopId) || {
      shopId,
      name,
      address,
      prices: {},
      updatedAt: {},
    };

    existing.name = existing.name || name;
    existing.address = existing.address || address;
    existing.prices[priceType] = price;
    existing.updatedAt[priceType] = confirmedAt;
    grouped.set(shopId, existing);
  }

  return [...grouped.values()];
}

function parseNumericPrice(value) {
  const numeric = Number(String(value).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.round(numeric);
}

function cleanHtmlText(value) {
  return decodeHtml(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}
