# 🌊 OC Conditions — Ocean City, MD Live Dashboard

A live weather & ocean conditions dashboard built for Ocean City lifeguards.
Pulls real data from NOAA and the National Weather Service every 10 minutes.

---

## What's In This Project

```
oc-conditions/
├── public/
│   └── index.html      ← The website (HTML + CSS + JavaScript)
├── src/
│   └── server.js       ← The backend (fetches weather data from APIs)
├── .env.example        ← Config template — copy to .env and edit
├── package.json        ← Project dependencies list
└── README.md           ← You're reading this
```

**How it works:**
1. `server.js` runs a mini web server on your computer
2. When the browser loads, it asks the server for conditions data
3. The server fetches from NOAA + NWS, packages it as JSON, sends it back
4. The browser displays it in the dashboard and refreshes every 10 minutes

---

## Setup (Do This Once)

### Step 1 — Install dependencies
Open a terminal in this folder and run:
```bash
npm install
```
This downloads Express (the web server library) and other tools.

### Step 2 — Create your config file
Copy the example config:
```bash
cp .env.example .env
```
Then open `.env` in VS Code and fill in your phone number and Gmail.

### Step 3 — Start the server
```bash
npm run dev
```
You should see:
```
🌊 OC Conditions running at http://localhost:3000
```

### Step 4 — Open the dashboard
Go to **http://localhost:3000** in your browser. That's it!

---

## What Each File Does (So You Can Edit It)

### `public/index.html`
This is your entire website — HTML structure, CSS styles, and JavaScript.
- **To change colors:** find `:root {` and edit the CSS variables
- **To add a new card:** copy an existing `<div class="card">` block
- **To change how data displays:** find the `set("element-id", ...)` lines in the `<script>` section

### `src/server.js`
This fetches data from external APIs and sends it to your browser.
- **To add a new data source:** add a new `fetch(...)` block and include it in the `conditions` object at the bottom
- **To change the NOAA station:** edit `NOAA_STATION` in `.env`

---

## Stages Roadmap

- ✅ **Stage 1** — Live dashboard (you are here)
- 🔜 **Stage 2** — User signup form + database (Supabase)
- 🔜 **Stage 3** — Daily 9:30 AM text alerts to subscribers
- 🔜 **Stage 4** — Deploy to the internet with a real URL

---

## Data Sources

| Data | Source | Update Frequency |
|------|--------|-----------------|
| Water & air temperature | NOAA Tides & Currents | Every 6 minutes |
| Wind speed & direction | NOAA Tides & Currents | Every 6 minutes |
| Tide height & predictions | NOAA Tides & Currents | Real-time |
| Weather forecast | National Weather Service | Hourly |
| UV Index | National Weather Service | Hourly |
| Wave height | Estimated from wind speed | Real-time (Stage 2 adds real surf data) |

All sources are **free** and require no API key.

---

## Common Issues

**"Cannot find module" error**
→ Run `npm install` first

**Dashboard shows "Error"**
→ Check your internet connection. NOAA's API occasionally has brief outages.

**Port 3000 already in use**
→ Change `PORT=3001` in your `.env` file

---

*Built for Ocean City, MD lifeguards 🏖️*
