# Deploy: GitHub → Render (devnet)

One public address: the **website**. It proxies `/api/*` to the API service over Render's private
network, so the "Log in with X" cookie is first-party. Nothing secret is in the repo: keys live in
Render's environment only.

## 1. Push to GitHub (private repo)
1. github.com → **New repository** → name `bountypad` → **Private** → no README → Create.
2. On your Mac, in `~/Downloads/bountypad`:
   ```bash
   git status            # must NOT list .env, api/.chain, programs/keys (they're ignored)
   git remote add origin https://github.com/<you>/bountypad.git
   git push -u origin main
   ```

## 2. Render
1. render.com → **New → Blueprint** → connect GitHub → pick `bountypad` → it reads `render.yaml`:
   a Postgres database, `bountypad-api` (Starter, always on: X watcher, fee keeper, payouts) and
   `bountypad-web` (the site).
2. It asks for the secret values. Leave them empty for now → **Apply**. Wait for the first deploy.
3. Copy the website URL (e.g. `https://bountypad-web.onrender.com`). On your Mac:
   ```bash
   npm run render:env -w api -- https://bountypad-web.onrender.com
   ```
   It prints every value from your `api/.env`, ready to paste.
4. Render → **bountypad-api → Environment → Add from .env** → paste the first block → Save.
   **bountypad-web → Environment** → paste the second block → Save. Both redeploy.

## 3. X app (developer.x.com → your app → User authentication settings)
- App permissions: **Read and write** · Type: **Web App, Automated App or Bot**
- Callback URI: `https://<website URL>/api/auth/x/callback` (keep the local one too)
- Website URL: `https://<website URL>`

## 4. Privy (dashboard.privy.io → your app)
- Allowed domains: add `https://<website URL>`

## 5. Check
- `https://<website URL>/api/health` → `"chain":"solana","cluster":"devnet","xMode":"real","xLogin":true`
- `/claim` → Log in with X → back on the site, "Confirmed by X".
- `/launch` → launch with your devnet wallet (≈ 0.027 SOL) → coin page with the explorer link.

Notes: free Render Postgres expires after 30 days (switch the plan to keep data). The free web
service sleeps after 15 min idle (first visit takes ~1 min); the API is on Starter so jobs never stop.
