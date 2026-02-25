-- Degree Graph — initial schema
-- Run via: npm run migrate

BEGIN;

CREATE TABLE IF NOT EXISTS papers (
  code        TEXT        PRIMARY KEY,          -- e.g. COMPX101
  title       TEXT        NOT NULL,
  points      INTEGER     NOT NULL DEFAULT 15,
  description TEXT,
  department  TEXT,                             -- e.g. COMPX, SOFTENG, MATHS
  semesters   TEXT[],                           -- e.g. ARRAY['A','B'] for both trimesters
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prerequisites (
  paper_code    TEXT NOT NULL REFERENCES papers(code) ON DELETE CASCADE,
  requires_code TEXT NOT NULL REFERENCES papers(code) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('pre', 'co')),
  PRIMARY KEY (paper_code, requires_code, type)
);

CREATE TABLE IF NOT EXISTS degrees (
  id            SERIAL      PRIMARY KEY,
  name          TEXT        NOT NULL,           -- e.g. Bachelor of Software Engineering
  code          TEXT        NOT NULL UNIQUE,    -- e.g. BSoftEng
  total_points  INTEGER     NOT NULL DEFAULT 360,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS degree_papers (
  degree_id      INTEGER NOT NULL REFERENCES degrees(id) ON DELETE CASCADE,
  paper_code     TEXT    NOT NULL REFERENCES papers(code) ON DELETE CASCADE,
  role           TEXT    NOT NULL CHECK (role IN ('compulsory', 'elective', 'specialisation')),
  elective_group TEXT,                          -- e.g. 'Group A', 'Group B'
  PRIMARY KEY (degree_id, paper_code)
);

CREATE TABLE IF NOT EXISTS user_progress (
  id                SERIAL      PRIMARY KEY,
  degree_id         INTEGER     NOT NULL REFERENCES degrees(id) ON DELETE CASCADE,
  completed_papers  TEXT[]      NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_prerequisites_paper_code
  ON prerequisites(paper_code);

CREATE INDEX IF NOT EXISTS idx_prerequisites_requires_code
  ON prerequisites(requires_code);

CREATE INDEX IF NOT EXISTS idx_degree_papers_degree_id
  ON degree_papers(degree_id);

CREATE INDEX IF NOT EXISTS idx_degree_papers_paper_code
  ON degree_papers(paper_code);

-- Seed the two target degrees
INSERT INTO degrees (name, code, total_points) VALUES
  ('Bachelor of Software Engineering', 'BSoftEng', 360),
  ('Bachelor of Computer Science',     'BCompSc',  360)
ON CONFLICT (code) DO NOTHING;

COMMIT;
