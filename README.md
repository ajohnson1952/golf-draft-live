# Open Draft Live

A mobile-friendly live leaderboard for the 2026 Open Championship draft.

## Run locally

1. Install Node.js 18 or newer.
2. Open a terminal in this folder.
3. Run `npm start`.
4. Open `http://localhost:3000`.

The server attempts to pull the tournament leaderboard from ESPN once per minute. Manual score/status overrides are available in the “Score control room” and persist in the browser.

## Deploy

Upload this folder to Render, Railway, Fly.io, or another Node host. The start command is `npm start`. No build command is required.

The default ESPN tournament ID is `401811957`. Override it with the environment variable `ESPN_EVENT_ID` if needed.
