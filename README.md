# Map Route Planner

Local web project for planning walking or running routes by target distance,
return-to-start preference, and overlap with previously saved routes.

The remote repository for this project is hosted on the local Gitea instance:

http://localhost:3000/admin/map

## Development

Copy `.env.example` to `.env` and fill the AMap keys:

```powershell
Copy-Item .env.example .env
```

Required keys:

- `VITE_AMAP_JS_KEY`: AMap JavaScript API key for browser map rendering.
- `VITE_AMAP_SECURITY_JS_CODE`: AMap JavaScript security code for local development.
- `AMAP_WEB_SERVICE_KEY`: AMap Web Service key for walking route planning.

Run the app:

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Phone Access With Cloudflare Tunnel

For mobile browser navigation, use HTTPS through Cloudflare Tunnel:

```powershell
npm run dev
cloudflared tunnel --url http://127.0.0.1:5173 --hostname map.rjsyfe324.ccwu.cc
```

Then open:

```text
https://map.rjsyfe324.ccwu.cc
```

Notes:

- Keep `PUBLIC_HOST=map.rjsyfe324.ccwu.cc` in `.env`.
- Add `https://map.rjsyfe324.ccwu.cc` to the AMap JS API allowed referrers if the map does not load.
- Mobile navigation needs browser location permission and works best on a phone with GPS.

Useful checks:

```powershell
npm run typecheck
npm run test
npm run build
```
