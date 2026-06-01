# Audience Go-Live Runbook

Use this checklist before every live show to reduce audience join failures and queue drops.

## 1) Required Supabase Auth settings

Set these in Supabase Dashboard -> Authentication -> Rate Limits.

1. Anonymous signups (`/signup`) per IP:
- Target: at least 120 requests/min/IP
- Better for crowded venues: 180 to 240 requests/min/IP

2. Burst tolerance:
- Keep burst handling enabled and avoid very low hard caps.
- If available in your plan, use a burst value that tolerates QR scan spikes in the first 2 to 5 minutes.

3. Anonymous provider:
- Must be enabled in Authentication -> Providers -> Anonymous.

4. Allowed URL / origin:
- Ensure production origin is configured and active.

Reason: your latest auth logs show `429 over_request_rate_limit` on `/signup` during audience join spikes.

## 2) 30-minute pre-show procedure

Run this exactly in order.

1. Verify app builds:
```powershell
npm run build
```
Pass rule:
- Build completes with no TypeScript errors.

2. Verify production health endpoints:
```powershell
pwsh -ExecutionPolicy Bypass -File .\smoke_test.ps1
```
Pass rule:
- `/api/keepwarm` returns 200.
- Validation endpoints can return 400/405 for invalid payload tests.

3. Verify responsive route stability:
```powershell
npm run dev
```
In a second terminal:
```powershell
$env:BASE_URL='http://localhost:5173'; npm run test:responsive
```
Pass rule:
- No route errors.
- No horizontal overflow failures.

4. Verify Supabase audience join under load:
- Ensure env vars are loaded in current terminal:
```powershell
$envMap = @{}
Get-Content .env | ForEach-Object {
  if($_ -match '^(?<k>[A-Z0-9_]+)=(?<v>.*)$'){ $envMap[$matches.k] = $matches.v }
}
if(-not $envMap.ContainsKey('VITE_SUPABASE_PUBLISHABLE_KEY') -and $envMap.ContainsKey('VITE_SUPABASE_ANON_KEY')){
  $envMap['VITE_SUPABASE_PUBLISHABLE_KEY'] = $envMap['VITE_SUPABASE_ANON_KEY']
}
foreach($k in @('VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY')){
  if($envMap.ContainsKey($k)){ Set-Item -Path ("Env:" + $k) -Value $envMap[$k] }
}
```
- Run baseline:
```powershell
npm run loadtest:audience -- --eventId=<LIVE_EVENT_ID> --concurrency=25 --rounds=2
```
- Run stress:
```powershell
npm run loadtest:audience -- --eventId=<LIVE_EVENT_ID> --concurrency=50 --rounds=2
```
Pass rule:
- Failure rate <= 5%
- P95 latency <= 8000ms
- Auth failures should be near 0 (no sustained 429 bursts)

5. Verify event state before opening room:
- Event is active
- `room_open = true` only when you are ready for requests
- Playlist and duplicate policies are configured as intended

## 3) Live show watch metrics (first 10 minutes)

Monitor in Supabase logs:

1. Auth logs:
- Watch for `/signup` status 429 spikes.
- Action threshold: if sustained > 2 minutes, increase rate limits.

2. API/DB behavior:
- Watch for 5xx spikes or timeout patterns.

3. App behavior:
- Audience diagnostics banner should stay mostly `Connected`.
- Queue mode should remain `normal` (not prolonged `degraded`).

## 4) Immediate fallback actions if audience cannot join

1. Keep room open and avoid changing multiple event toggles at once.
2. Increase anonymous signup rate limit in Supabase immediately.
3. Ask users to retry after 60 to 90 seconds (auth backoff and jitter are now in app).
4. Keep QR link unchanged during retries.
5. If needed, announce temporary manual queue intake while auth stabilizes.

## 5) Code protections already deployed

1. Queue submission is hardened against transient write failures.
2. Failed transient submissions are saved for automatic replay.
3. Audience auth retries are desynchronized with jitter to reduce retry storms.

## 6) Final go-live gate

Do not go live unless all are true:

1. Build passes.
2. Smoke and responsive checks pass.
3. Baseline load test passes thresholds.
4. No sustained auth 429 in recent logs.

If any gate fails, fix before opening audience room.
