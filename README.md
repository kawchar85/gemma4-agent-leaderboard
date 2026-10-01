# Gemma 4 Agent Leaderboard

Community tracker for the **Google – The Gemma 4 Developer Agent Competition** on Kaggle.

The project periodically snapshots the public leaderboard and records when a new leaderboard-visible submission is first observed. This makes it possible to estimate **observed scoring time** for future submissions and compare score/time trends across teams.

Live dashboard: **https://gemma4agent.kawchar.online**

## What “Observed Time” means

`Observed Time = first poll that sees the leaderboard result - Kaggle submission timestamp`

It is **not** Kaggle's internal agent execution time or GPU runtime. It includes any queueing, sandbox setup, agent execution, validation, scoring, publication delay, and the polling interval. The tracker should therefore be used as a community-visible turnaround metric, not as an exact runtime measurement.

The first snapshot after the tracker is enabled is treated as a baseline. Existing submissions are not assigned an observed time because their true first-visible time is unknown.

## What is tracked

- Public leaderboard rank
- Team name
- Public score
- Submission count when Kaggle exposes it
- Last leaderboard submission timestamp
- First time that submission was observed by this tracker
- Observed scoring time
- Per-team submission history from the moment tracking starts

Failed, timed-out, private, or otherwise non-leaderboard-visible submissions cannot be observed from the public leaderboard and may not appear.

## Architecture

```text
Kaggle public leaderboard
        |
        v
GitHub Actions (every 5 min)
        |
        v
scripts/collect.py
        |
        +--> data/state.json
        |
        +--> docs/data/leaderboard.json
                    |
                    v
              GitHub Pages
                    |
                    v
       gemma4agent.kawchar.online
```

## Setup

### 1. Add Kaggle authentication

Create a repository Actions secret named:

```text
KAGGLE_API_TOKEN
```

Use your Kaggle API token as the value. Never commit the token to this repository.

### 2. Enable GitHub Pages

In **Settings → Pages**:

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/docs**

The repository includes `docs/CNAME` for `gemma4agent.kawchar.online`.

### 3. Configure DNS

For `kawchar.online`, create a CNAME record:

```text
Type:  CNAME
Host:  gemma4agent
Value: kawchar85.github.io
```

Then set the custom domain in **Settings → Pages** to:

```text
gemma4agent.kawchar.online
```

### 4. Start the collector

The workflow runs every five minutes and can also be triggered manually from **Actions → Poll Kaggle leaderboard → Run workflow**.

## Local collection

With the Kaggle CLI authenticated:

```bash
python scripts/collect.py
```

The collector updates:

```text
data/state.json
docs/data/leaderboard.json
```

## Repository layout

```text
.github/workflows/poll.yml   Scheduled collector
scripts/collect.py           Kaggle snapshot + history logic
data/state.json              Persistent collector state
docs/index.html              Dashboard
docs/app.js                  Dashboard behavior
docs/style.css               Dashboard styles
docs/data/leaderboard.json   Public generated data
docs/CNAME                   Custom domain
```

## Notes

GitHub Actions schedules are best-effort and may occasionally run later than the requested five-minute cadence. Accordingly, observed times should be interpreted with roughly polling-interval precision.

## License

MIT
