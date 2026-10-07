# Keke Dodge Online v2

A mobile-first Abuja traffic endless runner with persistent leaderboard, live chat, touch/keyboard controls, shields, coins, progressive difficulty and a Railway health endpoint.

## Run
`npm start` then open `http://localhost:3000`.

## Railway
Use a Railway volume mounted at `/data` and `DATA_DIR=/data` to persist scores/chat. The server exposes `/health`, `/api/stats`, `/api/run`, `/api/scores`, `/api/chat`, and `/api/chat/stream`.
