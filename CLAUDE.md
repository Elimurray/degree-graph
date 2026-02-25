# Degree Graph

An interactive degree planning tool for University of Waikato students.
Scrapes degree pathway data including papers, prerequisites, and corequisites,
stores it in PostgreSQL, and visualises it as an interactive node graph.

## Stack

- Frontend: React 18 + Vite + Tailwind CSS
- Graph visualisation: React Flow (@xyflow/react)
- Backend: Node.js + Express
- Database: PostgreSQL (hosted on Raspberry Pi 5, accessible via ssh pi5)
- Scraping: Playwright (JS-heavy pages confirmed — Cheerio alone insufficient)
- Auth: None for MVP

## Repo Structure

- /client → React frontend
- /server → Express backend + scraper
- /db → Migrations, seeds, schema
- /scraper → Standalone scraping scripts

## Database

- Host: Pi 5 via `pi5@pi5.local`
- DB name: degree_graph
- PostgreSQL runs in Docker container named `boe_postgres`
- Connect: ssh pi5@pi5.local "docker exec -it boe_postgres psql -U eli -d degree_graph"
- Run migrations: ssh pi5@pi5.local "docker exec -i boe_postgres psql -U eli -d degree_graph -f -" < db/migrations/<file>.sql
- Create DB if needed: ssh pi5@pi5.local "docker exec boe_postgres createdb -U eli degree_graph"
- **Migration commands use stdin redirection (`<`) and must be run in cmd.exe, not PowerShell**

## University of Waikato

- Paper base URL: https://www.waikato.ac.nz/study/papers/<CODE>/2026/
- Subject regulations: https://www.waikato.ac.nz/study/subject-regulations/software-engineering
- Subject regulations: https://www.waikato.ac.nz/study/subject-regulations/computer-science
- Each paper occurrence has a code (e.g. COMPX103-25B (HAM)) code being "COMPX103", year "25", trimester "B", location "HAM", title, points, prerequisites, corequisites, and description
- Degrees are made up of compulsory papers, electives, and specialisations

## Conventions

- Named exports only, no default exports for components
- Hooks in /client/src/hooks/
- API routes prefixed with /api/
- All DB queries go through /server/src/db/ — never raw SQL in routes
- Use async/await, never .then()
- Tailwind only for styling, no inline styles or CSS files

## Commands

- npm run dev → starts both client and server (concurrently)
- npm run scrape → runs the scraper
- npm run migrate → runs pending migrations on pi5

## Current Status

- [x] Project scaffolded
- [ ] Scraper built
- [x] Database schema designed
- [ ] Backend API built
- [ ] Frontend graph view built
