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
- `API_ACCESS_TOKEN`: optional shared access token for route planning and history APIs. Set this before exposing the app publicly.

When `API_ACCESS_TOKEN` is set, the browser will ask for it before it can generate,
save, rename, delete, or read history routes. The app sends it as a Bearer token.

Run the app:

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:25173`.

## Phone Access With Cloudflare Tunnel

For mobile browser navigation, use HTTPS through Cloudflare Tunnel:

```powershell
npm run dev
cloudflared tunnel --url http://127.0.0.1:25173 --hostname map.rjsyfe324.ccwu.cc
```

Set `API_ACCESS_TOKEN` in `.env` before using the public URL, then open:

```text
https://map.rjsyfe324.ccwu.cc
```

Notes:

- Keep `PUBLIC_HOST=map.rjsyfe324.ccwu.cc` in `.env`.
- Keep `API_ACCESS_TOKEN` set when the tunnel is reachable from the internet.
- Add `https://map.rjsyfe324.ccwu.cc` to the AMap JS API allowed referrers if the map does not load.
- Mobile navigation needs browser location permission and works best on a phone with GPS.

## Local Helpers

Use the root scripts when you want to bring the whole stack up or stop it:

```powershell
.\start.ps1
.\stop.ps1
```

Useful startup variants:

```powershell
.\start.ps1 -NoTunnel
.\start.ps1 -Check
```

The npm helpers are still available:

```powershell
npm run local:start
npm run local:check
npm run local:stop
```

What they do:

- `local:start`: starts the backend, frontend, and Cloudflare tunnel if they are not already running and refuses ports that are occupied by the wrong service.
- `local:check`: checks `.env`, app health on local ports, API health, tunnel status, and public health.
- `local:stop`: stops the local app processes started by the helper.

The scripts write pid and log files into `.runtime/`.

Useful checks:

```powershell
npm run typecheck
npm run test
npm run build
```
