#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import os
import shutil
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

COMPETITION = os.getenv("KAGGLE_COMPETITION", "gemma-4-developer-agent")
ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / "data" / "state.json"
PUBLIC_PATH = ROOT / "docs" / "data" / "leaderboard.json"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None

    candidates = [value, value.replace(" ", "T", 1)]
    for candidate in candidates:
        try:
            if candidate.endswith("Z"):
                candidate = candidate[:-1] + "+00:00"
            dt = datetime.fromisoformat(candidate)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            pass

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def first(row: dict[str, str], *names: str) -> str:
    for name in names:
        value = row.get(name)
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    return ""


def maybe_number(value: str) -> int | float | str | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except ValueError:
        return value


def prepare_legacy_kaggle_json() -> None:
    """Support a secret containing the legacy kaggle.json document.

    Modern Kaggle CLI versions can consume KAGGLE_API_TOKEN directly. Some users
    store the entire old-style kaggle.json document in the secret instead; when
    that is detected we materialize it for the CLI.
    """
    token = os.getenv("KAGGLE_API_TOKEN", "").strip()
    if not token.startswith("{"):
        return
    try:
        parsed = json.loads(token)
    except json.JSONDecodeError:
        return
    if not isinstance(parsed, dict):
        return

    kaggle_dir = Path.home() / ".kaggle"
    kaggle_dir.mkdir(parents=True, exist_ok=True)
    target = kaggle_dir / "kaggle.json"
    target.write_text(json.dumps(parsed))
    target.chmod(0o600)


def download_leaderboard() -> list[dict[str, str]]:
    prepare_legacy_kaggle_json()

    with tempfile.TemporaryDirectory(prefix="gemma4-leaderboard-") as tmp:
        tmp_path = Path(tmp)
        cmd = [
            "kaggle",
            "competitions",
            "leaderboard",
            COMPETITION,
            "--download",
            "--path",
            str(tmp_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(
                "Kaggle leaderboard download failed:\n"
                + (result.stderr or result.stdout or "unknown error")
            )

        for archive in tmp_path.glob("*.zip"):
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(tmp_path)

        csv_files = sorted(tmp_path.glob("*.csv"))
        if not csv_files:
            raise RuntimeError(
                f"No CSV found after leaderboard download. Files: "
                f"{[p.name for p in tmp_path.iterdir()]}"
            )

        with csv_files[0].open(newline="", encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return {"schema_version": 1, "tracking_started_at": None, "events": {}}
    return json.loads(STATE_PATH.read_text())


def event_key(row: dict[str, Any]) -> str:
    # Submission timestamp is the best public identifier. The fallback keeps the
    # tracker useful if Kaggle changes the downloaded CSV schema.
    if row["submitted_at"]:
        return f"submitted:{row['submitted_at']}"
    return f"fallback:{row['submission_count']}:{row['score']}"


def normalize(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for index, raw in enumerate(rows, start=1):
        team_id = first(raw, "TeamId", "teamId", "team_id")
        team_name = first(raw, "TeamName", "teamName", "team_name", "Name")
        if not team_id:
            team_id = team_name or f"row-{index}"

        submitted_raw = first(
            raw,
            "LastSubmissionDate",
            "SubmissionDate",
            "lastSubmissionDate",
            "submissionDate",
            "submittedAt",
        )
        submitted_dt = parse_dt(submitted_raw)

        rank = maybe_number(first(raw, "Rank", "rank"))
        if not isinstance(rank, int):
            rank = index

        result.append(
            {
                "team_id": str(team_id),
                "team_name": team_name or str(team_id),
                "rank": rank,
                "score": maybe_number(first(raw, "Score", "score", "PublicScore")),
                "submission_count": maybe_number(
                    first(raw, "SubmissionCount", "submissionCount", "submissions")
                ),
                "submitted_at": iso(submitted_dt) if submitted_dt else (submitted_raw or None),
            }
        )
    return result


def main() -> None:
    now = utc_now()
    raw_rows = download_leaderboard()
    current = normalize(raw_rows)
    state = load_state()

    initial_snapshot = not bool(state.get("tracking_started_at"))
    if initial_snapshot:
        state["tracking_started_at"] = iso(now)

    events: dict[str, list[dict[str, Any]]] = state.setdefault("events", {})
    new_events = 0

    for row in current:
        team_events = events.setdefault(row["team_id"], [])
        key = event_key(row)
        existing = next((e for e in team_events if e.get("key") == key), None)

        if existing is None:
            observed_minutes: int | None = None
            if not initial_snapshot:
                submitted_dt = parse_dt(row.get("submitted_at"))
                if submitted_dt is not None:
                    observed_minutes = max(
                        0, int((now - submitted_dt).total_seconds() // 60)
                    )

            existing = {
                "key": key,
                "submitted_at": row.get("submitted_at"),
                "first_seen_at": iso(now),
                "observed_minutes": observed_minutes,
                "baseline": initial_snapshot,
                "score": row.get("score"),
                "rank": row.get("rank"),
                "submission_count": row.get("submission_count"),
            }
            team_events.append(existing)
            new_events += 1
        else:
            # Keep first_seen_at/observed_minutes immutable, but retain the latest
            # public score/rank in case Kaggle republishes leaderboard metadata.
            existing["score"] = row.get("score")
            existing["rank"] = row.get("rank")
            existing["submission_count"] = row.get("submission_count")

        row["first_seen_at"] = existing.get("first_seen_at")
        row["observed_minutes"] = existing.get("observed_minutes")
        row["baseline"] = existing.get("baseline", False)

    for team_events in events.values():
        team_events.sort(key=lambda e: e.get("first_seen_at") or "")

    state["competition"] = COMPETITION
    state["last_polled_at"] = iso(now)
    state["events"] = events

    tracked_events = [
        event
        for team_events in events.values()
        for event in team_events
        if not event.get("baseline")
    ]
    observed_values = [
        int(event["observed_minutes"])
        for event in tracked_events
        if event.get("observed_minutes") is not None
    ]

    public = {
        "meta": {
            "schema_version": 1,
            "competition": COMPETITION,
            "updated_at": iso(now),
            "tracking_started_at": state["tracking_started_at"],
            "poll_interval_minutes": 5,
            "team_count": len(current),
            "tracked_event_count": len(tracked_events),
            "observed_event_count": len(observed_values),
            "new_events_this_poll": new_events,
            "measurement": (
                "Observed Time = first poll that sees a leaderboard result minus "
                "Kaggle's public submission timestamp. It is not exact execution runtime."
            ),
        },
        "leaderboard": current,
        "history": events,
    }

    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    PUBLIC_PATH.write_text(json.dumps(public, indent=2, sort_keys=True) + "\n")

    print(
        f"Polled {len(current)} teams; {new_events} new event(s); "
        f"{len(tracked_events)} post-baseline event(s)."
    )


if __name__ == "__main__":
    main()
