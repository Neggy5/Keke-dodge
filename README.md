# Keke Dodge Online v3

Multiplayer Abuja traffic runner.

## Added
- Persistent rider profiles with server-issued identity tokens
- Live rider state broadcasting over SSE
- Online rider presence and visible live riders
- Persistent coin economy
- Shield inventory and shield shop (₦50)
- Player-linked leaderboard
- Server-side run ownership and score/distance validation
- Existing live chat, leaderboard, mobile controls and Abuja zones retained
- `/health` reports version 3
- Persistent `/data/db.json` storage

## Run
`npm start`

## Railway
Mount the existing volume at `/data` and set `DATA_DIR=/data`.
