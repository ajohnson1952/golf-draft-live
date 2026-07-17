# Caveman PGA Draft Game v14

## Change notes

- Team cards remain still during ordinary score refreshes.
- A card animates only when that team’s actual competition rank changes.
- Tied teams retain their existing display order instead of swapping alphabetically on refresh.
- Genuine rank movement uses a shorter, subtler 320 ms transition.
- Green/red score flashes still occur only for real moves up or down.
- Updated browser cache version to v14.

All v13 functionality remains included: live ESPN scoring, best-three totals, prior-round movement, Groups to Watch, recent highlights, team/golfer details, payouts, and the navy/white theme.


## v15 changes
- Tee times are converted to America/Chicago and labeled CT/CDT as appropriate.
- Scheduled golfers no longer appear as finished before starting their round.
- Current-round scoring is suppressed until the golfer has actually started.

## v16 fix

- A future Central-time tee time or ESPN pre-round state now overrides stale `F`/18-hole values left over from the prior round.
- Players waiting to tee off show their tee time (or `Not started`) instead of `Finished round`.
- Added an explicit current-round `started` flag from the server and made the UI prioritize it.

## v17 change

- Expanded player-name normalization for ESPN names containing non-decomposing special characters. In particular, `Nicolai Højgaard` now correctly matches the drafted `Nicolai Hojgaard`.
- Added transliteration support for `ø`, `æ`, `å`, `ł`, `ð`, `þ`, and `ß` to make future international-player matching more reliable.

## v18 changes
- Added ESPN golfer headshots with initials fallbacks.
- Added headshots to golfer detail, team detail, Hot/Cold, and Groups to Watch.
- Added live hole, tee-time, finished, and cut status badges.
- Redesigned the golfer modal around a larger athlete profile header.
- Added an experimental Featured Matchup card for the top two teams, including projected win share and golfers currently on course.
- No official tournament logo or R&A artwork is bundled; the site retains its original Caveman branding.
