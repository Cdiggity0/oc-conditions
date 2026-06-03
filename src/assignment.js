const fetch = require("node-fetch");

const ASSIGNMENT_CSV = "https://docs.google.com/spreadsheets/d/1mF9DwCriKMlSpfLH0-9LHRCZemuc0SXwEAhJ3pvdpMs/export?format=csv";

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

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

    return null;
  }
  return null;
}

module.exports = { fetchAssignment };
