// scripts/update-readme.js
// Node 18+ (uses global fetch)
const fs = require("fs");
const path = require("path");

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error(
    "Missing GITHUB_TOKEN. This should be available inside GitHub Actions as a secret."
  );
  process.exit(1);
}

// Compute last-year range
const to = new Date();
const from = new Date(to);
from.setFullYear(to.getFullYear() - 1);
const fromISO = from.toISOString();
const toISO = to.toISOString();

async function graphql(query, variables = {}) {
  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "update-readme-script",
    },
    body: JSON.stringify({ query, variables }),
  });
  const j = await res.json();
  if (j.errors) {
    console.error("GraphQL errors:", JSON.stringify(j.errors, null, 2));
    throw new Error("GraphQL query failed");
  }
  return j.data;
}

function makeStatsSVG({
  totalCommitContributions,
  totalPullRequestContributions,
  totalPullRequestReviewContributions,
  totalIssueContributions,
}) {
  const width = 720;
  const height = 140;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .card { fill: #0b1220; stroke: #2b2130; stroke-width: 2; rx: 12; ry: 12; }
    .title { font: 700 18px 'Segoe UI', Roboto, Arial; fill: #ff6b9a; }
    .label { font: 600 14px 'Segoe UI', Roboto, Arial; fill: #9be3d6; }
    .value { font: 700 20px 'Segoe UI', Roboto, Arial; fill: #bde7ff; }
  </style>

  <rect width="100%" height="100%" fill="#071025"/>

  <g transform="translate(18,18)">
    <rect class="card" x="0" y="0" width="${width - 36}" height="${
    height - 36
  }" rx="12" ry="12"/>
    <text x="24" y="34" class="title">GitHub — Recent Stats (last 1 year)</text>

    <g transform="translate(24,54)">
      <text x="0" y="0" class="label">Commits (last year)</text>
      <text x="0" y="22" class="value">${totalCommitContributions}</text>

      <text x="180" y="0" class="label">Pull Requests (last year)</text>
      <text x="180" y="22" class="value">${totalPullRequestContributions}</text>

      <text x="360" y="0" class="label">PR Reviews (last year)</text>
      <text x="360" y="22" class="value">${totalPullRequestReviewContributions}</text>

      <text x="540" y="0" class="label">Issues (last year)</text>
      <text x="540" y="22" class="value">${totalIssueContributions}</text>
    </g>
  </g>
</svg>
`.trim();
}

function makeCalendarSVG(calendar) {
  const square = 12;
  const gap = 3;
  const cols = calendar.weeks.length;
  const rows = calendar.weeks[0]?.contributionDays.length || 7;
  const width = cols * (square + gap) + 40;
  const height = rows * (square + gap) + 80;

  let rects = [];
  calendar.weeks.forEach((week, wi) => {
    week.contributionDays.forEach((day, di) => {
      const x = wi * (square + gap) + 20;
      const y = di * (square + gap) + 30;
      let color = pickColorFromCount(day.contributionCount);
      rects.push({ x, y, color, count: day.contributionCount, date: day.date });
    });
  });

  const legend = `
  <g transform="translate(${20},${rows * (square + gap) + 42})">
    <text x="0" y="12" style="font:600 12px 'Segoe UI', Roboto, Arial; fill:#9aa6b2">Less</text>
    ${[0, 1, 2, 3, 4]
      .map((i, idx) => {
        const cx = 54 + idx * (square + gap);
        const c = legendColor(i);
        return `<rect x="${cx}" y="0" width="${square}" height="${square}" rx="2" ry="2" fill="${c}"/>`;
      })
      .join("")}
    <text x="${
      54 + 5 * (square + gap)
    }" y="12" style="font:600 12px 'Segoe UI', Roboto, Arial; fill:#9aa6b2">More</text>
  </g>
  `;

  const rectElems = rects
    .map(
      (r) =>
        `<rect x="${r.x}" y="${r.y}" width="${square}" height="${square}" rx="2" ry="2" fill="${r.color}" data-count="${r.count}" data-date="${r.date}"/>`
    )
    .join("\n");

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .title { font: 700 16px 'Segoe UI', Roboto, Arial; fill: #a6ffcb; }
    .sub { font: 500 12px 'Segoe UI', Roboto, Arial; fill: #9aa6b2; }
  </style>
  <rect width="100%" height="100%" fill="#071025"/>
  <text x="20" y="18" class="title">Contributions Calendar (last year)</text>
  <text x="20" y="30" class="sub">Squares show date & count</text>
  ${rectElems}
  ${legend}
</svg>
`.trim();
}

function pickColorFromCount(count) {
  if (!count) return "#ebedf0";
  if (count < 2) return "#c6e48b";
  if (count < 5) return "#7bc96f";
  if (count < 10) return "#239a3b";
  return "#196127";
}
function legendColor(i) {
  switch (i) {
    case 0:
      return "#ebedf0";
    case 1:
      return "#c6e48b";
    case 2:
      return "#7bc96f";
    case 3:
      return "#239a3b";
    default:
      return "#196127";
  }
}

async function main() {
  const query = `
  query($from: DateTime!, $to: DateTime!) {
    viewer {
      login
      name
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        totalPullRequestReviewContributions
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }`;

  const variables = { from: fromISO, to: toISO };
  const data = await graphql(query, variables);
  const col = data.viewer.contributionsCollection;

  const statsSvg = makeStatsSVG({
    totalCommitContributions: col.totalCommitContributions,
    totalPullRequestContributions: col.totalPullRequestContributions,
    totalPullRequestReviewContributions:
      col.totalPullRequestReviewContributions,
    totalIssueContributions: col.totalIssueContributions,
  });

  const calendarSvg = makeCalendarSVG(col.contributionCalendar);

  const readmePath = path.join(process.cwd(), "README.md");
  let readme = fs.readFileSync(readmePath, "utf8");

  readme = replaceBetween(
    readme,
    "<!-- STATS_START -->",
    "<!-- STATS_END -->",
    `<!-- STATS_START -->\n\n${wrapAsImg(
      statsSvg,
      "github-stats"
    )}\n\n<!-- STATS_END -->`
  );
  readme = replaceBetween(
    readme,
    "<!-- ACTIVITY_START -->",
    "<!-- ACTIVITY_END -->",
    `<!-- ACTIVITY_START -->\n\n${wrapAsImg(
      calendarSvg,
      "github-activity"
    )}\n\n<!-- ACTIVITY_END -->`
  );

  fs.writeFileSync(readmePath, readme, "utf8");
  console.log("README updated with fresh stats.");
}

function wrapAsImg(svg, id) {
  return `\n<div id="${id}">\n${svg}\n</div>\n`;
}

function replaceBetween(text, startMarker, endMarker, replacement) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    console.warn(
      `Markers ${startMarker} or ${endMarker} not found. Skipping replacement for them.`
    );
    return text;
  }
  const before = text.substring(0, start);
  const after = text.substring(end + endMarker.length);
  return before + replacement + after;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
