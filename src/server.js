// ============================================================
// OC Conditions — Express Server
// src/server.js
//
// HOW IT WORKS:
// - Runs a local web server on port 3000
// - Has one main API route: GET /api/conditions
//   This fetches data from NOAA + NWS and returns it as JSON
// - Serves the frontend (public/index.html) at the root URL
// ============================================================

require("dotenv").config();
const express = require("express");
const fetch   = require("node-fetch");
const path    = require("path");

const { sendDailyTexts } = require("./sms-cron");

const app  = express();
const PORT = process.env.PORT || 3000;

const fs = require("fs");
const SUBSCRIBERS_PATH = path.join(__dirname, "../subscribers.json");

app.use(express.json());

// Serve static files (HTML, CSS, JS) from the public folder
app.use(express.static(path.join(__dirname, "../public")));

// ── NOAA Station Config ───────────────────────────────────────
const STATION = process.env.NOAA_STATION || "8570283";
const NOAA_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

// ── Assignment sheet ──────────────────────────────────────────
const ASSIGNMENT_CSV = "https://docs.google.com/spreadsheets/d/1mF9DwCriKMlSpfLH0-9LHRCZemuc0SXwEAhJ3pvdpMs/export?format=csv";

// ── Helper: fetch NOAA product ────────────────────────────────
async function fetchNOAA(product, extra = "") {
  const url = `${NOAA_BASE}?station=${STATION}&product=${product}` +
    `&time_zone=lst_ldt&units=english&format=json&date=latest${extra}`;
  const res  = await fetch(url);
  const data = await res.json();
  return data;
}

// ── Helper: compass direction from degrees ────────────────────
function degreesToCompass(deg) {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
                "S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── Helper: surf condition label from wave height ─────────────
function surfLabel(ft) {
  if (ft < 1)  return { label: "Flat",        emoji: "😴", color: "#94a3b8" };
  if (ft < 2)  return { label: "Ankle-Knee",  emoji: "🤙", color: "#38bdf8" };
  if (ft < 3)  return { label: "Waist High",  emoji: "🏄", color: "#22c55e" };
  if (ft < 5)  return { label: "Chest-Head",  emoji: "🔥", color: "#f59e0b" };
  if (ft < 8)  return { label: "Overhead",    emoji: "⚠️",  color: "#ef4444" };
  return              { label: "Dangerous",   emoji: "🚨", color: "#7f1d1d" };
}

// ── Helper: ordinal suffix (1→"1st", 36→"36th", etc.) ────────
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Helper: fetch today's assignment from Google Sheet ────────
async function fetchAssignment() {
  const res  = await fetch(ASSIGNMENT_CSV);
  const text = await res.text();

  const lines   = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim());

  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month:    "2-digit",
    day:      "2-digit",
    year:     "numeric",
  });

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim());
    const row  = {};
    headers.forEach((h, j) => row[h] = cols[j] || "");

    if (row["Date"] !== today) continue;

    if (row["Unnasigned"] === "TRUE") return "Cameron — Unassigned";

    const num = parseInt(row["Location"], 10);
    if (!isNaN(num)) {
      const suffix = row["Lunch"] === "TRUE" ? "Lunch" : "All Day";
      return `Cameron — ${ordinal(num)} Street, ${suffix}`;
    }

    return null; // blank or "-" → day off
  }
  return null;
}

// ── Assignment Route ──────────────────────────────────────────
app.get("/api/assignment", async (req, res) => {
  try {
    const assignment = await fetchAssignment();
    res.json({ ok: true, data: { assignment } });
  } catch (err) {
    console.error("Assignment fetch failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Subscribe Route ───────────────────────────────────────────
app.post("/api/subscribe", (req, res) => {
  const { name, phone, email } = req.body || {};
  if (!name || !phone) {
    return res.status(400).json({ ok: false, error: "Name and phone are required." });
  }
  const digits = phone.replace(/\D/g, "");
  if (digits.length !== 10) {
    return res.status(400).json({ ok: false, error: "Please enter a valid 10-digit US phone number." });
  }
  const subscribers = JSON.parse(fs.readFileSync(SUBSCRIBERS_PATH, "utf8"));
  if (subscribers.some(s => s.phone.replace(/\D/g, "") === digits)) {
    return res.status(409).json({ ok: false, error: "That number is already subscribed." });
  }
  const entry = { name: name.trim(), phone: digits };
  if (email && email.trim()) entry.email = email.trim().toLowerCase();
  subscribers.push(entry);
  fs.writeFileSync(SUBSCRIBERS_PATH, JSON.stringify(subscribers, null, 2));
  console.log(`[subscribe] New subscriber: ${name.trim()} (${digits})${entry.email ? ` <${entry.email}>` : ""}`);
  res.json({ ok: true });
});

// ── Main API Route ────────────────────────────────────────────
// Frontend calls this every 10 minutes to refresh data
app.get("/api/conditions", async (req, res) => {
  try {
    const now = new Date();

    // ── 1. Water Temperature ───────────────────────────────────
    let waterTemp = null;
    try {
      const wt = await fetchNOAA("water_temperature");
      if (wt.data) waterTemp = parseFloat(wt.data[wt.data.length - 1].v);
    } catch(e) { console.warn("Water temp fetch failed:", e.message); }

    // ── 2. Air Temperature — NWS hourly (land-based, reflects beach conditions)
    // Deliberately NOT using the NOAA buoy air temp — that sensor sits over water
    // and reads differently than the beach due to sea breeze effects.
    // NWS uses land-based stations and is what the Ocean City beach forecast is based on.
    let airTemp = null;
    // (pulled below from NWS hourly fetch, alongside UV)

    // ── 3. Wind ────────────────────────────────────────────────
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

    // ── 4. Water Level (current tide height) ──────────────────
    let tideHeight = null;
    try {
      const wl = await fetchNOAA("water_level");
      if (wl.data) tideHeight = parseFloat(wl.data[wl.data.length - 1].v);
    } catch(e) { console.warn("Water level fetch failed:", e.message); }

    // ── 5. Tide Predictions (High/Low for today + tomorrow) ───
    let tidePredictions = [];
    try {
      const today    = now.toISOString().slice(0,10).replace(/-/g,"");
      const tomorrow = new Date(now.getTime() + 86400000)
                         .toISOString().slice(0,10).replace(/-/g,"");
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

    // Next high and low from predictions
    const upcoming  = tidePredictions.filter(p => new Date(p.time) > now);
    const nextHigh  = upcoming.find(p => p.type === "High") || null;
    const nextLow   = upcoming.find(p => p.type === "Low")  || null;

    // ── 6. NWS Forecast (text + UV) ───────────────────────────
    let forecast = null, uvIndex = null;
    try {
      const nwsRes  = await fetch(
        `https://api.weather.gov/gridpoints/${process.env.NWS_OFFICE || "AKQ"}/${process.env.NWS_GRID_X || 51},${process.env.NWS_GRID_Y || 20}/forecast`
      );
      const nwsData = await nwsRes.json();
      if (nwsData.properties && nwsData.properties.periods) {
        const period = nwsData.properties.periods[0];
        forecast = {
          name:        period.name,
          temperature: period.temperature,
          tempUnit:    period.temperatureUnit,
          windSpeed:   period.windSpeed,
          windDir:     period.windDirection,
          shortForecast: period.shortForecast,
          detailedForecast: period.detailedForecast,
          icon:        period.icon,
        };
      }
    } catch(e) { console.warn("NWS forecast fetch failed:", e.message); }

    // ── 7. Air Temp + UV Index from Open-Meteo ───────────────
    // Open-Meteo uses the same underlying weather models as Apple Weather /
    // Weather Channel / Weather Underground — so readings will closely match
    // what users see on their phones, establishing credibility.
    // Free, no API key needed. Coords: Ocean City, MD beach (38.3365, -75.0849)
    try {
      const omUrl = `https://api.open-meteo.com/v1/forecast?` +
        `latitude=38.3365&longitude=-75.0849` +
        `&current=temperature_2m,uv_index` +
        `&temperature_unit=fahrenheit` +
        `&wind_speed_unit=kn` +
        `&timezone=America%2FNew_York`;
      const omRes  = await fetch(omUrl);
      const omData = await omRes.json();
      if (omData.current) {
        airTemp = omData.current.temperature_2m ?? null;
        uvIndex = omData.current.uv_index       ?? null;
        if (uvIndex !== null) uvIndex = Math.round(uvIndex);
      }
    } catch(e) { console.warn("Open-Meteo fetch failed:", e.message); }

    // ── 8. OC Beach Patrol — Rip Current Risk + Surf Beaches ────
    let ripCurrentRisk = null;
    let surfingBeaches = null;
    try {
      const ocRes = await fetch("https://oceancitymd.gov/bp/surf_report/index.php", {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
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

    // ── 9. Surf / Wave Height (NOAA wave product) ─────────────
    // NOAA doesn't provide surf height for this station directly,
    // so we estimate from wind speed (a rough but useful approximation)
    // Stage 2 will add a real surf API (Surfline/Spitcast)
    let waveHeightFt = null, surfCondition = null;
    if (windSpeed !== null) {
      // Simple Beaufort-based wave estimate for coastal waters
      waveHeightFt = Math.max(0, (windSpeed * 0.18) - 0.5);
      waveHeightFt = parseFloat(waveHeightFt.toFixed(1));
      surfCondition = surfLabel(waveHeightFt);
    }

    // ── Build response object ──────────────────────────────────
    const conditions = {
      updatedAt: now.toISOString(),
      station: {
        id:   STATION,
        name: "Ocean City Inlet, MD",
      },
      water: {
        tempF:      waterTemp,
        levelFt:    tideHeight,
      },
      air: {
        tempF:      airTemp,
      },
      wind: {
        speedKnots: windSpeed,
        gustKnots:  windGust,
        direction:  windDir,
      },
      tides: {
        current:    tideHeight,
        nextHigh,
        nextLow,
        predictions: tidePredictions,
      },
      surf: {
        waveHeightFt,
        condition:   surfCondition,
        note: "Wave height is estimated from wind speed. Real surf data coming in Stage 2.",
      },
      ripCurrentRisk,
      surfingBeaches,
      forecast,
      uvIndex,
    };

    res.json({ ok: true, data: conditions });

  } catch (err) {
    console.error("Fatal error in /api/conditions:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Test SMS Route ────────────────────────────────────────────
app.get("/test-sms", async (_req, res) => {
  try {
    await sendDailyTexts();
    res.json({ ok: true, message: "Test texts sent — check server logs for details." });
  } catch (err) {
    console.error("[test-sms] Error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌊 OC Conditions running at http://localhost:${PORT}`);
  console.log(`   API available at http://localhost:${PORT}/api/conditions\n`);
});
