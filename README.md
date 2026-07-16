# Caveman PGA Draft Game

A live friends leaderboard for the Caveman PGA Draft Game.

## Scoring

- Five golfers per team.
- Best three scores relative to par count.
- After the cut, missed-cut, withdrawn, and disqualified golfers are frozen and no longer eligible unless required to fill a three-player scoring team.
- Lowest team total wins.

## Run locally

```bash
npm start
```

Open `http://localhost:3000`.

## Render deployment

Push these files to the connected GitHub repository. Render will automatically redeploy.

The ESPN tournament is selected with the `ESPN_EVENT_ID` environment variable. The default currently points to event `401811957`.
