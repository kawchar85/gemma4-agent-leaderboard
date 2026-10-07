const DATA_URL = "data/leaderboard.json";
const PAGE_SIZE = 50;
const RECENT_LIMIT = 10;

const $ = (id) => document.getElementById(id);
let data = null;
let currentPage = 1;
let currentQuery = "";

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

function relativeTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function cell(value, className = "") {
  const td = document.createElement("td");
  td.textContent = value ?? "—";
  if (className) td.className = className;
  return td;
}

function teamCell(teamId, teamName) {
  const td = document.createElement("td");
  td.className = "team";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "team-link";
  button.dataset.teamId = String(teamId);
  button.dataset.teamName = teamName || String(teamId);
  button.textContent = teamName || String(teamId);
  button.title = `View ${button.textContent} submission history`;
  td.append(button);
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

function trackedEvents() {
  return Object.values(data.history || {})
    .flat()
    .filter((event) => !event.baseline);
}

function renderSummary() {
  const observed = trackedEvents().filter(
    (event) => event.observed_minutes !== null && event.observed_minutes !== undefined
  );
  const medianMinutes = median(observed.map((event) => Number(event.observed_minutes)));
  const count = data.meta?.tracked_event_count ?? trackedEvents().length;
  const updated = relativeTime(data.meta?.updated_at);

  const medianText = medianMinutes === null ? "Median score time: —" : `Median score time: ${formatDuration(medianMinutes)}`;
  const trackedText = `${count} tracked submission${count === 1 ? "" : "s"}`;
  $("summary").textContent = `${medianText} · ${trackedText} · Updated ${updated}`;

  $("trackingSince").textContent = data.meta?.tracking_started_at
    ? `Tracking since ${formatDate(data.meta.tracking_started_at)}`
    : "Tracker initializing…";
}

function filteredLeaderboard() {
  const needle = currentQuery.trim().toLowerCase();
  return (data.leaderboard || []).filter((row) =>
    !needle || String(row.team_name || "").toLowerCase().includes(needle)
  );
}

function renderLeaderboard() {
  const body = $("leaderboardBody");
  body.replaceChildren();

  const rows = filteredLeaderboard();
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = cell(data.meta?.updated_at ? "No matching teams." : "Waiting for the first collector run…", "empty");
    td.colSpan = 6;
    tr.append(td);
    body.append(tr);
  } else {
    const start = (currentPage - 1) * PAGE_SIZE;
    for (const row of rows.slice(start, start + PAGE_SIZE)) {
      const tr = document.createElement("tr");
      tr.append(
        cell(row.rank, "rank"),
        teamCell(row.team_id, row.team_name),
        cell(row.score, "score"),
        cell(row.submission_count),
        cell(formatDate(row.submitted_at)),
        cell(row.baseline ? "Baseline" : formatDuration(row.observed_minutes), row.baseline ? "muted" : "duration")
      );
      body.append(tr);
    }
  }

  $("pageInfo").textContent = `Page ${currentPage} of ${totalPages}`;
  $("prevPage").disabled = currentPage <= 1;
  $("nextPage").disabled = currentPage >= totalPages;
  $("pagination").hidden = rows.length <= PAGE_SIZE;
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
    const td = cell("No tracked submissions yet.", "empty");
    td.colSpan = 4;
    tr.append(td);
    body.append(tr);
    return;
  }

  for (const event of events.slice(0, RECENT_LIMIT)) {
    const tr = document.createElement("tr");
    tr.append(
      teamCell(event.teamId, event.teamName),
      cell(event.score, "score"),
      cell(formatDate(event.submitted_at)),
      cell(formatDuration(event.observed_minutes), "duration")
    );
    body.append(tr);
  }
}

function teamHistory(teamId) {
  return [...(data.history?.[String(teamId)] || [])].sort((a, b) => {
    const aKey = a.submitted_at || a.first_seen_at || "";
    const bKey = b.submitted_at || b.first_seen_at || "";
    return String(bKey).localeCompare(String(aKey));
  });
}

function openTeamHistory(teamId, fallbackName = "") {
  const row = (data.leaderboard || []).find((item) => String(item.team_id) === String(teamId));
  const teamName = row?.team_name || fallbackName || String(teamId);
  const events = teamHistory(teamId);

  $("teamDialogTitle").textContent = teamName;

  const meta = [];
  if (row?.rank !== null && row?.rank !== undefined) meta.push(`Rank #${row.rank}`);
  if (row?.score !== null && row?.score !== undefined) meta.push(`Current score ${row.score}`);
  if (row?.submission_count !== null && row?.submission_count !== undefined) {
    meta.push(`${row.submission_count} submission${Number(row.submission_count) === 1 ? "" : "s"}`);
  }
  $("teamDialogMeta").textContent = meta.join(" · ");

  const body = $("teamHistoryBody");
  body.replaceChildren();

  if (!events.length) {
    const tr = document.createElement("tr");
    const td = cell("No history recorded for this team yet.", "empty");
    td.colSpan = 4;
    tr.append(td);
    body.append(tr);
  } else {
    for (const event of events) {
      const tr = document.createElement("tr");
      const submissionNumber = event.submission_count ?? "—";
      const scoreTime = event.baseline ? "Before tracking" : formatDuration(event.observed_minutes);
      tr.append(
        cell(submissionNumber),
        cell(formatDate(event.submitted_at)),
        cell(event.score, "score"),
        cell(scoreTime, event.baseline ? "muted" : "duration")
      );
      body.append(tr);
    }
  }

  const dialog = $("teamDialog");
  if (!dialog.open) dialog.showModal();
}

function bindTeamClicks(container) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest(".team-link");
    if (!button) return;
    openTeamHistory(button.dataset.teamId, button.dataset.teamName);
  });
}

async function init() {
  try {
    const response = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();

    renderSummary();
    renderHistory();
    renderLeaderboard();

    bindTeamClicks($("historyBody"));
    bindTeamClicks($("leaderboardBody"));

    $("search").addEventListener("input", (event) => {
      currentQuery = event.target.value;
      currentPage = 1;
      renderLeaderboard();
    });

    $("prevPage").addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderLeaderboard();
      }
    });

    $("nextPage").addEventListener("click", () => {
      const totalPages = Math.max(1, Math.ceil(filteredLeaderboard().length / PAGE_SIZE));
      if (currentPage < totalPages) {
        currentPage += 1;
        renderLeaderboard();
      }
    });

    $("teamDialogClose").addEventListener("click", () => $("teamDialog").close());
    $("teamDialog").addEventListener("click", (event) => {
      if (event.target === $("teamDialog")) $("teamDialog").close();
    });
  } catch (error) {
    console.error(error);
    $("summary").textContent = "Unable to load tracker data.";
    $("historyBody").innerHTML = '<tr><td colspan="4" class="empty">Unable to load recent submissions.</td></tr>';
    $("leaderboardBody").innerHTML = '<tr><td colspan="6" class="empty">Unable to load leaderboard data.</td></tr>';
    $("pagination").hidden = true;
  }
}

init();
