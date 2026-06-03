const cron       = require("node-cron");
const nodemailer = require("nodemailer");

const { fetchConditions }      = require("./conditions");
const { getTodaysSurfBeaches } = require("./surfBeaches");
const { fetchAssignment }      = require("./assignment");

function fmtTime(str) {
  if (!str) return "--";
  return new Date(str).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York",
  });
}

function calcRipLevel(data) {
  let score = 0;
  const ws = data.wind.speedKnots;
  if (ws !== null) {
    if (ws >= 20) score += 2;
    else if (ws >= 12) score += 1;
  }
  const offshoreWinds = ["S","SSW","SW","SSE","SE","WSW"];
  if (data.wind.direction && offshoreWinds.includes(data.wind.direction)) score += 1;
  const wh = data.surf.waveHeightFt;
  if (wh !== null) {
    if (wh >= 4) score += 2;
    else if (wh >= 2) score += 1;
  }
  const { nextHigh, nextLow } = data.tides;
  if (nextHigh && nextLow) {
    if (new Date(nextLow.time) < new Date(nextHigh.time)) score += 1;
  }
  score = Math.min(score, 5);
  return ["Low","Low-Mod","Moderate","High","Extreme"][Math.max(0, score - 1)] || "Low";
}

async function buildMessage() {
  try {
    const d = await fetchConditions();

    const high = d.tides.nextHigh ? fmtTime(d.tides.nextHigh.time) : "--";
    const low  = d.tides.nextLow  ? fmtTime(d.tides.nextLow.time)  : "--";
    const wt   = d.water.tempF    != null ? Math.round(d.water.tempF) : "--";
    const at   = d.air.tempF      != null ? Math.round(d.air.tempF)   : "--";
    const wind = d.wind.speedKnots != null
      ? `${Math.round(d.wind.speedKnots)}${d.wind.direction ? " " + d.wind.direction : ""}`
      : "--";
    const rip  = calcRipLevel(d);

    const lines = [
      "Surf Report:",
      `HIGH: ${high}`,
      `LOW: ${low}`,
      `WT: ${wt}`,
      `AT: ${at}`,
      `WIND: ${wind}`,
      `RIP: ${rip}`,
    ];

    try {
      const { south, north, inlet } = getTodaysSurfBeaches();
      if (south) lines.push(`SURF S: ${south}`);
      if (north) lines.push(`SURF N: ${north}`);
      if (inlet) lines.push(`INLET: ${inlet}`);
    } catch (e) {
      console.warn("[sms-cron] Surf beaches skipped:", e.message);
    }

    try {
      const assignment = await fetchAssignment();
      if (assignment) lines.push(assignment);
    } catch (e) {
      console.warn("[sms-cron] Assignment fetch skipped:", e.message);
    }

    return lines.join("\n");
  } catch (err) {
    console.error("[sms-cron] Failed to build message:", err.message);
    return "Surf Report: Data unavailable today.";
  }
}

async function sendDailyTexts() {
  const to = process.env.NOTIFY_EMAIL;
  if (!to) {
    console.log("[sms-cron] NOTIFY_EMAIL not set — skipping.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  try {
    await transporter.sendMail({
      from:    process.env.GMAIL_USER,
      to,
      subject: "Daily Surf Report",
      text:    await buildMessage(),
    });
    console.log(`[sms-cron] Email sent to ${to}`);
  } catch (err) {
    console.error(`[sms-cron] Email failed:`, err.message);
  }
}

module.exports = { sendDailyTexts };

// Runs daily at 9:30 AM Eastern
cron.schedule("30 9 * * *", () => {
  console.log("[sms-cron] Firing daily surf email...");
  sendDailyTexts().catch(err => console.error("[sms-cron] Unexpected error:", err));
}, { timezone: "America/New_York" });

console.log("[sms-cron] Scheduled — daily surf email at 9:30 AM ET");
