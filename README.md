# Degree Graph

Interactive prerequisite map for University of Waikato degrees. Select a degree, click papers to mark them complete, and watch the papers they unlock light up.

Currently supports:

- Bachelor of Software Engineering
- Bachelor of Computer Science

## Stack

| Layer    | Technology                             |
| -------- | -------------------------------------- |
| Frontend | React 18 + Vite + Tailwind CSS v4      |
| Graph    | @xyflow/react (React Flow v12)         |
| Backend  | Node.js + Express                      |
| Database | PostgreSQL in Docker on Raspberry Pi 5 |
| Scraper  | Playwright + Cheerio                   |

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
│   ├── migrations/       # 001_, 002_, 003_... SQL files run in order
│   ├── migrate.js        # migration runner with schema_migrations tracking
│   └── seed.js           # per-degree seed script
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

### Run migrations

```bash
npm run migrate
```

Automatically detects and runs any `.sql` files in `db/migrations/` that haven't been applied yet, tracked in a `schema_migrations` table. Safe to run multiple times — already-applied migrations are skipped.

### Scrape data

```bash
# By slug
npm run scrape -- software-engineering
npm run scrape -- civil-engineering
npm run scrape -- computer-science

# By full URL
npm run scrape -- "https://www.waikato.ac.nz/study/subject-regulations/mechanical-engineering"

# Unknown degree — supply metadata manually
npm run scrape -- creative-technologies --name "Bachelor of Creative Technologies" --points 360

# Override the derived degree code
npm run scrape -- software-engineering --code MY-CODE

# Re-fetch all paper details (overwrite existing paper records)
npm run scrape -- software-engineering --force
```

### Seed a degree

```bash
npm run seed -- computer-science
npm run seed -- BE-SE
npm run seed -- civil-engineering   # case-insensitive
```

Seeds only the specified degree from `scraper/data/` into the database — upserts papers and the degree, rebuilds its `degree_papers` rows — without touching any other degree already in the database. The argument can be a degree code (`BE-SE`) or a slug (`civil-engineering`).

### Run

```bash
npm run dev
```

Opens the client at `http://localhost:5173`, API at `http://localhost:3002`.

## API

| Method | Endpoint                          | Description                        |
| ------ | --------------------------------- | ---------------------------------- |
| GET    | `/api/degrees`                    | List all degrees                   |
| GET    | `/api/degrees/:id`                | Degree metadata                    |
| GET    | `/api/degrees/:id/graph`          | Nodes + edges in React Flow format |
| GET    | `/api/papers`                     | All papers                         |
| GET    | `/api/papers/:code`               | Single paper                       |
| GET    | `/api/papers/:code/prerequisites` | Prerequisites for a paper          |
| POST   | `/api/progress`                   | Create a progress session          |
| GET    | `/api/progress/:id`               | Get progress                       |
| PATCH  | `/api/progress/:id`               | Update completed papers            |
| DELETE | `/api/progress/:id`               | Delete progress                    |

## Database

PostgreSQL runs in Docker on a Raspberry Pi 5. Migrations are managed by `db/migrate.js` and tracked in a `schema_migrations` table — drop a new numbered `.sql` file into `db/migrations/` and run `npm run migrate`.

### Schema

```
papers          — code (PK), title, points, description, department, semesters
prerequisites   — paper_code, requires_code, type ('pre'|'co'), group_index
degrees         — id, name, code, total_points
degree_papers   — degree_id, paper_code, role, elective_group
user_progress   — id, degree_id, completed_papers[]
```

`group_index` encodes CNF prerequisite logic: rows sharing the same `(paper_code, group_index)` are OR alternatives; rows with different `group_index` values for the same paper are AND requirements.

## Re-scraping a degree

To update a degree's data end-to-end:

```bash
npm run scrape -- software-engineering --force   # re-scrape papers (overwrite existing)
npm run seed -- software-engineering             # re-seed into the database
```
