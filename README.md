# Degree Graph

Interactive prerequisite map for University of Waikato degrees. Select a degree, click papers to mark them complete, and watch the papers they unlock light up.

Currently supports:

- Bachelor of Software Engineering
- Bachelor of Computer Science

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS v4 |
| Graph | @xyflow/react (React Flow v12) |
| Backend | Node.js + Express |
| Database | PostgreSQL in Docker on Raspberry Pi 5 |
| Scraper | Playwright + Cheerio |

## Features

- **Year-level layout** — papers arranged in rows by level (100 → 200 → 300 → 500)
- **Dynamic unlocking** — papers are locked until their prerequisites are met; completing a paper animates and reveals what it unlocks
- **CNF prerequisite logic** — correctly handles AND/OR prerequisite groups (e.g. "MATHS135 and one of COMPX201/241" rather than requiring all of them)
- **Edge rendering** — solid lines for prerequisites, dashed for corequisites; edges dim to locked grey until the source paper is complete
- **Hover tooltips** — hovering a locked node shows which prerequisites are still needed
- **Paper detail panel** — click any unlocked paper to see its full description, points, semesters, and role
- **Points tracker** — live "X / 360 points" count as you mark papers complete

## Project Structure

```
degree-graph/
├── client/               # React frontend
│   └── src/
│       ├── components/   # DegreeGraph, PaperNode, PaperDetail, DegreeSelector
│       └── hooks/        # useDegreeGraph, useDegrees, useProgress
├── server/               # Express API
│   └── src/
│       ├── routes/       # /api/papers, /api/degrees, /api/progress
│       ├── db/           # pg query functions (graph, papers, degrees, progress)
│       └── utils/        # graph layout + topological sort
├── db/
│   ├── migrations/       # 001_initial_schema.sql, 002_add_prereq_group_index.sql
│   └── seed.js           # imports scraper/data/*.json into PostgreSQL
└── scraper/
    ├── src/scrapers/     # degrees.js, papers.js
    └── src/utils/        # browser.js, prereqParser.js, addPrereqGroups.js
```

## Getting Started

### Prerequisites

- Node.js 18+

### Install

```bash
npm install
cd scraper && npx playwright install chromium
```

### Configure

```bash
cp .env.example .env

```

### Database setup

Run in **cmd.exe** (not PowerShell — stdin redirection `<` requires cmd.exe):

```cmd
npm run migrate
```

### Scrape data

```bash
npm run scrape
```

Produces `scraper/data/papers.json` and `scraper/data/degrees.json`.

### Seed database

```bash
node db/seed.js
```

### Run

```bash
npm run dev
```

Opens the client at `http://localhost:5173`, API at `http://localhost:3002`.

## API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/degrees` | List all degrees |
| GET | `/api/degrees/:id` | Degree metadata |
| GET | `/api/degrees/:id/graph` | Nodes + edges in React Flow format |
| GET | `/api/papers` | All papers |
| GET | `/api/papers/:code` | Single paper |
| GET | `/api/papers/:code/prerequisites` | Prerequisites for a paper |
| POST | `/api/progress` | Create a progress session |
| GET | `/api/progress/:id` | Get progress |
| PATCH | `/api/progress/:id` | Update completed papers |
| DELETE | `/api/progress/:id` | Delete progress |

## Database

PostgreSQL runs in Docker on a Raspberry Pi 5.

### Schema

```
papers          — code (PK), title, points, description, department, semesters
prerequisites   — paper_code, requires_code, type ('pre'|'co'), group_index
degrees         — id, name, code, total_points
degree_papers   — degree_id, paper_code, role, elective_group
user_progress   — id, degree_id, completed_papers[]
```

`group_index` encodes CNF prerequisite logic: rows sharing the same `(paper_code, group_index)` are OR alternatives; rows with different `group_index` values for the same paper are AND requirements.

## Re-scraping

If paper data needs updating:

```bash
npm run scrape                         # re-scrape all papers
node scraper/src/utils/addPrereqGroups.js  # re-parse AND/OR prereq groups
node db/seed.js                        # re-seed the database
```
