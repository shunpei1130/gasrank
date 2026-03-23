const { getOverpassPayload } = require("../server.js");

module.exports = async (request, response) => {
  const lat = Number(request.query.lat);
  const lng = Number(request.query.lng);
  const radiusKm = Number(request.query.radiusKm || "5");

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    response.status(400).json({
      error: "invalid_coordinates",
      message: "現在地の座標が不正です。",
    });
    return;
  }

  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 30) {
    response.status(400).json({
      error: "invalid_radius",
      message: "検索半径が不正です。",
    });
    return;
  }

  try {
    const payload = await getOverpassPayload({ lat, lng, radiusKm });
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    response.status(200).json(payload);
  } catch (error) {
    console.error("vercel overpass api failed", error);
    response.status(502).json({
      error: "overpass_lookup_failed",
      message: "周辺スタンド情報の取得に失敗しました。",
    });
  }
};
