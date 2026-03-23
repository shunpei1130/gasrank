const { getMunicipalityPricePayload } = require("../server.js");

module.exports = async (request, response) => {
  const lat = Number(request.query.lat);
  const lng = Number(request.query.lng);
  const fuelType = request.query.fuelType || "regular";

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    response.status(400).json({
      error: "invalid_coordinates",
      message: "現在地の座標が不正です。",
    });
    return;
  }

  if (!["regular", "premium", "diesel"].includes(fuelType)) {
    response.status(400).json({
      error: "invalid_fuel_type",
      message: "油種が不正です。",
    });
    return;
  }

  try {
    const payload = await getMunicipalityPricePayload({ lat, lng, fuelType });
    response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
    response.status(200).json(payload);
  } catch (error) {
    console.error("vercel api failed", error);
    response.status(502).json({
      error: "price_lookup_failed",
      message: "地域価格の取得に失敗しました。",
    });
  }
};
