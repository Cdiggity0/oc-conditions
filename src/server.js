require("dotenv").config();
const express = require("express");
const path    = require("path");
const fs      = require("fs");

const { sendDailyTexts }       = require("./sms-cron");
const { getTodaysSurfBeaches } = require("./surfBeaches");
const { fetchConditions }      = require("./conditions");
const { fetchAssignment }      = require("./assignment");

const app  = express();
const PORT = process.env.PORT || 3000;

const SUBSCRIBERS_PATH = path.join(__dirname, "../subscribers.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

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

// ── Surf Beaches Route ────────────────────────────────────────
app.get("/api/surf-beaches", (req, res) => {
  try {
    res.json({ ok: true, data: getTodaysSurfBeaches() });
  } catch (err) {
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

// ── Main Conditions Route ─────────────────────────────────────
app.get("/api/conditions", async (req, res) => {
  try {
    res.json({ ok: true, data: await fetchConditions() });
  } catch (err) {
    console.error("Fatal error in /api/conditions:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Test Email Route ──────────────────────────────────────────
app.get("/test-sms", async (_req, res) => {
  try {
    await sendDailyTexts();
    res.json({ ok: true, message: "Test email sent — check server logs for details." });
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
