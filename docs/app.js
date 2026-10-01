const DATA_URL = "data/leaderboard.json";

const $ = (id) => document.getElementById(id);
let data = null;

function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return "—";
  const total = Number(minutes);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  if (days) return `${days}d ${hours}h ${mins}m`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function cell(value, className = "") {
  const td = document.createElement("td");
  td.textContent = value ?? "—";
  if (className) td.className = className;
  return td;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function renderStats() {
  const events = Object.values(data.history || {})
    .flat()
    .filter((event) => !event.baseline && event.observed_minutes !== null && event.observed_minutes !== undefined);

  $("teamCount").textContent = data.meta?.team_count ?? data.leaderboard?.length ?? 0;
  $("eventCount").textContent = data.meta?.tracked_event_count ?? events.length;
  $("medianTime").textContent = formatDuration(median(events.map((event) => Number(event.observed_minutes))));
  $("lastUpdate").textContent = formatDate(data.meta?.updated_at);
  $("trackingSince").textContent = data.meta?.tracking_started_at
    ? `Tracking since ${formatDate(data.meta.tracking_started_at)}`
    : "Tracker initializing…";
}

function renderLeaderboard(query = "") {
  const body = $("leaderboardBody");
  body.replaceChildren();
  const needle = query.trim().toLowerCase();

  const rows = (data.leaderboard || []).filter((row) =>
    !needle || String(row.team_name || "").toLowerCase().includes(needle)
  );

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = cell(data.meta?.updated_at ? "No matching teams." : "Waiting for the first collector run…", "empty");
    td.colSpan = 6;
    tr.append(td);
    body.append(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.append(
      cell(row.rank, "rank"),
      cell(row.team_name, "team"),
      cell(row.score, "score"),
      cell(row.submission_count),
      cell(formatDate(row.submitted_at)),
      cell(row.baseline ? "Baseline" : formatDuration(row.observed_minutes), row.baseline ? "muted" : "duration")
    );
    body.append(tr);
  }
}

function renderHistory() {
  const body = $("historyBody");
  body.replaceChildren();

  const names = new Map((data.leaderboard || []).map((row) => [String(row.team_id), row.team_name]));
  const events = [];
  for (const [teamId, teamEvents] of Object.entries(data.history || {})) {
    for (const event of teamEvents) {
      if (event.baseline) continue;
      events.push({ teamId, teamName: names.get(String(teamId)) || teamId, ...event });
    }
  }

  events.sort((a, b) => String(b.first_seen_at || "").localeCompare(String(a.first_seen_at || "")));

  if (!events.length) {
    const tr = document.createElement("tr");
    const td = cell("No post-baseline submissions observed yet.", "empty");
    td.colSpan = 5;
    tr.append(td);
    body.append(tr);
    return;
  }

  for (const event of events.slice(0, 100)) {
    const tr = document.createElement("tr");
    tr.append(
      cell(formatDate(event.first_seen_at)),
      cell(event.teamName, "team"),
      cell(event.score, "score"),
      cell(formatDate(event.submitted_at)),
      cell(formatDuration(event.observed_minutes), "duration")
    );
    body.append(tr);
  }
}

async function init() {
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    renderStats();
    renderLeaderboard();
    renderHistory();
    $("search").addEventListener("input", (event) => renderLeaderboard(event.target.value));
  } catch (error) {
    console.error(error);
    $("leaderboardBody").innerHTML = '<tr><td colspan="6" class="empty">Unable to load leaderboard data.</td></tr>';
  }
}

init();
