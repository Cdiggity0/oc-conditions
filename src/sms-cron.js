const cron       = require("node-cron");
const twilio     = require("twilio");
const nodemailer = require("nodemailer");
const fetch      = require("node-fetch");
const fs         = require("fs");
const path       = require("path");

const SUBSCRIBERS_PATH = path.join(__dirname, "../subscribers.json");

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
    const res  = await fetch("http://localhost:3000/api/conditions");
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "API error");
    const d = json.data;

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
      const aRes  = await fetch("http://localhost:3000/api/assignment");
      const aJson = await aRes.json();
      if (aJson.ok && aJson.data.assignment) lines.push(aJson.data.assignment);
    } catch (e) {
      console.warn("[sms-cron] Assignment fetch skipped:", e.message);
    }

    return lines.join("\n");
  } catch (err) {
    console.error("[sms-cron] Failed to fetch conditions:", err.message);
    return "Surf Report: Data unavailable today.";
  }
}

async function sendDailyTexts() {
  const subscribers = JSON.parse(fs.readFileSync(SUBSCRIBERS_PATH, "utf8"));
  if (!subscribers.length) {
    console.log("[sms-cron] No subscribers — skipping send.");
    return;
  }

  await sendEmailReport();

  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
  const body = await buildMessage();

  for (const sub of subscribers) {
    const digits = sub.phone.replace(/\D/g, "");
    if (digits.length !== 10) {
      console.warn(`[sms-cron] Skipping ${sub.name} — invalid phone: ${sub.phone}`);
      continue;
    }
    try {
      await client.messages.create({
        from: process.env.TWILIO_PHONE_NUMBER,
        to:   `+1${digits}`,
        body,
      });
      console.log(`[sms-cron] SMS sent to ${sub.name} (+1${digits})`);
    } catch (err) {
      console.error(`[sms-cron] SMS failed for ${sub.name} (+1${digits}):`, err.message);
    }

    if (sub.email) {
      try {
        await transporter.sendMail({
          from:    process.env.GMAIL_USER,
          to:      sub.email,
          subject: "Daily Surf Report",
          text:    body,
        });
        console.log(`[sms-cron] Email sent to ${sub.name} (${sub.email})`);
      } catch (err) {
        console.error(`[sms-cron] Email failed for ${sub.name} (${sub.email}):`, err.message);
      }
    }
  }
}

async function sendEmailReport() {
  const to = process.env.NOTIFY_EMAIL;
  if (!to) return;

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
    console.error(`[sms-cron] Email failed for ${to}:`, err.message);
  }
}

module.exports = { sendDailyTexts };

// Runs daily at 9:30 AM Eastern
cron.schedule("30 9 * * *", () => {
  console.log("[sms-cron] Firing daily surf text...");
  sendDailyTexts().catch(err => console.error("[sms-cron] Unexpected error:", err));
}, { timezone: "America/New_York" });

console.log("[sms-cron] Scheduled — daily surf texts at 9:30 AM ET");
