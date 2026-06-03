const fetch = require("node-fetch");

const STATION   = process.env.NOAA_STATION || "8570283";
const NOAA_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

async function fetchNOAA(product, extra = "") {
  const url = `${NOAA_BASE}?station=${STATION}&product=${product}` +
    `&time_zone=lst_ldt&units=english&format=json&date=latest${extra}`;
  return (await fetch(url)).json();
}

function degreesToCompass(deg) {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
                "S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function surfLabel(ft) {
  if (ft < 1)  return { label: "Flat",        emoji: "😴", color: "#94a3b8" };
  if (ft < 2)  return { label: "Ankle-Knee",  emoji: "🤙", color: "#38bdf8" };
  if (ft < 3)  return { label: "Waist High",  emoji: "🏄", color: "#22c55e" };
  if (ft < 5)  return { label: "Chest-Head",  emoji: "🔥", color: "#f59e0b" };
  if (ft < 8)  return { label: "Overhead",    emoji: "⚠️",  color: "#ef4444" };
  return              { label: "Dangerous",   emoji: "🚨", color: "#7f1d1d" };
}

async function fetchConditions() {
  const now = new Date();

  // 1. Water Temperature
  let waterTemp = null;
  try {
    const wt = await fetchNOAA("water_temperature");
    if (wt.data) waterTemp = parseFloat(wt.data[wt.data.length - 1].v);
  } catch(e) { console.warn("Water temp fetch failed:", e.message); }

  // Air temp populated below from Open-Meteo
  let airTemp = null;

  // 2. Wind
  let windSpeed = null, windDir = null, windGust = null;
  try {
    const wd = await fetchNOAA("wind");
    if (wd.data) {
      const w = wd.data[wd.data.length - 1];
      windSpeed = parseFloat(w.s);
      windDir   = degreesToCompass(parseFloat(w.d));
      windGust  = parseFloat(w.g) || null;
    }
  } catch(e) { console.warn("Wind fetch failed:", e.message); }

  // 3. Water Level
  let tideHeight = null;
  try {
    const wl = await fetchNOAA("water_level");
    if (wl.data) tideHeight = parseFloat(wl.data[wl.data.length - 1].v);
  } catch(e) { console.warn("Water level fetch failed:", e.message); }

  // 4. Tide Predictions (High/Low for today + tomorrow)
  let tidePredictions = [];
  try {
    const today    = now.toISOString().slice(0,10).replace(/-/g,"");
    const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0,10).replace(/-/g,"");
    const url = `${NOAA_BASE}?station=${STATION}&product=predictions` +
      `&datum=MLLW&time_zone=lst_ldt&units=english&format=json` +
      `&begin_date=${today}&end_date=${tomorrow}&interval=hilo`;
    const tp = await (await fetch(url)).json();
    if (tp.predictions) {
      tidePredictions = tp.predictions.map(p => ({
        time:   p.t,
        type:   p.type === "H" ? "High" : "Low",
        height: parseFloat(p.v).toFixed(2),
      }));
    }
  } catch(e) { console.warn("Tide predictions fetch failed:", e.message); }

  const upcoming = tidePredictions.filter(p => new Date(p.time) > now);
  const nextHigh = upcoming.find(p => p.type === "High") || null;
  const nextLow  = upcoming.find(p => p.type === "Low")  || null;

  // 5. NWS Forecast
  let forecast = null;
  try {
    const nwsRes  = await fetch(
      `https://api.weather.gov/gridpoints/${process.env.NWS_OFFICE || "AKQ"}/${process.env.NWS_GRID_X || 51},${process.env.NWS_GRID_Y || 20}/forecast`
    );
    const nwsData = await nwsRes.json();
    if (nwsData.properties && nwsData.properties.periods) {
      const period = nwsData.properties.periods[0];
      forecast = {
        name:             period.name,
        temperature:      period.temperature,
        tempUnit:         period.temperatureUnit,
        windSpeed:        period.windSpeed,
        windDir:          period.windDirection,
        shortForecast:    period.shortForecast,
        detailedForecast: period.detailedForecast,
        icon:             period.icon,
      };
    }
  } catch(e) { console.warn("NWS forecast fetch failed:", e.message); }

  // 6. Air Temp + UV from Open-Meteo
  // Free, no API key needed. Coords: Ocean City, MD beach (38.3365, -75.0849)
  let uvIndex = null;
  try {
    const omUrl = `https://api.open-meteo.com/v1/forecast?` +
      `latitude=38.3365&longitude=-75.0849` +
      `&current=temperature_2m,uv_index` +
      `&temperature_unit=fahrenheit` +
      `&wind_speed_unit=kn` +
      `&timezone=America%2FNew_York`;
    const omData = await (await fetch(omUrl)).json();
    if (omData.current) {
      airTemp = omData.current.temperature_2m ?? null;
      uvIndex = omData.current.uv_index       ?? null;
      if (uvIndex !== null) uvIndex = Math.round(uvIndex);
    }
  } catch(e) { console.warn("Open-Meteo fetch failed:", e.message); }

  // 7. OC Beach Patrol — Rip Current Risk
  let ripCurrentRisk = null;
  let surfingBeaches = null;
  try {
    const ocRes = await fetch("https://oceancitymd.gov/bp/surf_report/index.php", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" }
    });
    const html = await ocRes.text();
    const ripMatch = html.match(/Rip current risk:<\/th>\s*<td>([^<]+)<\/td>/i);
    if (ripMatch) ripCurrentRisk = ripMatch[1].trim();
    const beachesMatch = html.match(/Beaches:<\/th>\s*<td>([\s\S]*?)<\/td>/i);
    if (beachesMatch) {
      const content = beachesMatch[1];
      surfingBeaches = {
        north: /137th/i.test(content),
        south: /57th/i.test(content),
        inlet: /Inlet/i.test(content),
      };
    }
  } catch(e) { console.warn("OC surf report fetch failed:", e.message); }

  // 8. Wave height estimate from wind speed
  let waveHeightFt = null, surfCondition = null;
  if (windSpeed !== null) {
    waveHeightFt  = parseFloat(Math.max(0, (windSpeed * 0.18) - 0.5).toFixed(1));
    surfCondition = surfLabel(waveHeightFt);
  }

  return {
    updatedAt: now.toISOString(),
    station: { id: STATION, name: "Ocean City Inlet, MD" },
    water:   { tempF: waterTemp, levelFt: tideHeight },
    air:     { tempF: airTemp },
    wind:    { speedKnots: windSpeed, gustKnots: windGust, direction: windDir },
    tides:   { current: tideHeight, nextHigh, nextLow, predictions: tidePredictions },
    surf:    { waveHeightFt, condition: surfCondition, note: "Wave height is estimated from wind speed. Real surf data coming in Stage 2." },
    ripCurrentRisk,
    surfingBeaches,
    forecast,
    uvIndex,
  };
}

module.exports = { fetchConditions };
