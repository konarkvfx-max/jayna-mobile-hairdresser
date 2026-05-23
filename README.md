# Jayna Mobile Hairdresser — Daily Schedule App

Backend + frontend for Jayna's mobile hairdressing business. Shows daily schedule with drive times between appointments, live booking updates via WebSocket, and full Waitwhile integration.

## Stack

- **Server**: Node.js / Express / WebSocket (`ws`)
- **Frontend**: Single-file React 18 (UMD + Babel standalone)
- **APIs**: Waitwhile v2, Google Maps Distance Matrix
- **Deploy**: Railway (single deployment serves both API + frontend)

## Project Structure

```
├── server.js                 # Express server + WebSocket + static serving
├── package.json
├── .env.example              # Environment variable template
├── .gitignore
├── public/
│   └── index.html            # Production frontend (React SPA)
├── routes/
│   ├── bookings.js           # GET /bookings, POST create/confirm/cancel
│   ├── services.js           # GET /services (Waitwhile catalogue)
│   ├── schedule.js           # GET /schedule-with-drive-times?date=YYYY-MM-DD
│   ├── webhook.js            # POST /webhook (Waitwhile events)
│   └── block.js              # POST /block (block time slots)
└── lib/
    ├── waitwhile.js           # Waitwhile API wrapper
    ├── maps.js                # Google Maps Distance Matrix wrapper
    └── websocket.js           # WebSocket broadcast logic
```

## Local Setup

```bash
# 1. Clone
git clone https://github.com/konarkvfx-max/jayna-mobile-hairdresser.git
cd jayna-mobile-hairdresser

# 2. Install dependencies
npm install

# 3. Create .env from template
cp .env.example .env
# Fill in your API keys

# 4. Run
node server.js
# Server starts at http://localhost:3001
```

## Environment Variables

| Variable | Description |
|---|---|
| `WAITWHILE_API_KEY` | Waitwhile API key (Business plan required) |
| `WAITWHILE_LOCATION_ID` | Waitwhile location ID |
| `GOOGLE_MAPS_API_KEY` | Google Maps API key (Distance Matrix enabled) |
| `WAITWHILE_WEBHOOK_SECRET` | Optional — for webhook signature verification |
| `PORT` | Server port (default: 3001, Railway sets this automatically) |

## Deploy to Railway

1. Push this repo to GitHub
2. Create new Railway project → "Deploy from GitHub repo"
3. Set environment variables in Railway dashboard
4. Railway auto-detects Node.js, runs `npm start`
5. Get your Railway URL (e.g. `https://jayna-xyz.up.railway.app`)
6. Configure Waitwhile webhook URL: `https://YOUR_RAILWAY_URL/webhook`

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/bookings` | All upcoming bookings (today + 30 days) |
| POST | `/bookings/create` | Create new booking |
| POST | `/bookings/:id/confirm` | Confirm pending booking |
| POST | `/bookings/:id/cancel` | Cancel booking |
| GET | `/services` | Service catalogue |
| GET | `/schedule-with-drive-times?date=YYYY-MM-DD` | Day schedule with drive times |
| POST | `/webhook` | Waitwhile webhook receiver |
| POST | `/block` | Block time slot |
| GET | `/health` | Health check |

## Notes

- Frontend uses same-origin API calls (`API_URL = ''`) — no CORS issues
- WebSocket auto-reconnects on disconnect (5s retry)
- Service catalogue cached for 10 minutes
- All times displayed in Adelaide timezone (ACST/ACDT)
- Waitwhile Business plan required for API/webhook access (currently on Starter)
