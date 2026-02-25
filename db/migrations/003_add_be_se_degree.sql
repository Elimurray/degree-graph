-- Rollback: DELETE FROM degree_papers WHERE degree_id = (SELECT id FROM degrees WHERE code = 'BE-SE');
--           DELETE FROM degrees WHERE code = 'BE-SE';

BEGIN;

-- Insert the BE(Hons) Software Engineering degree, upsert if already present
INSERT INTO degrees (name, code, total_points)
VALUES ('Bachelor of Engineering (Honours) in Software Engineering', 'BE-SE', 480)
ON CONFLICT (code) DO UPDATE
  SET name         = EXCLUDED.name,
      total_points = EXCLUDED.total_points;

-- Insert degree_papers using the degree id resolved inline.
-- All 73 papers already exist in the papers table so no paper inserts are needed.
-- Rows with role='compulsory' that carry an elective_group represent OR-choice
-- compulsory slots (e.g. Year-2-OR-choice) and are stored as-is.
INSERT INTO degree_papers (degree_id, paper_code, role, elective_group)
SELECT d.id, v.paper_code, v.role::TEXT, v.elective_group
FROM degrees d
CROSS JOIN (VALUES
  ('COMPX101', 'compulsory', NULL),
  ('COMPX102', 'compulsory', NULL),
  ('ENGEN101', 'compulsory', NULL),
  ('ENGEN102', 'compulsory', NULL),
  ('ENGEN170', 'compulsory', NULL),
  ('ENGEN180', 'compulsory', NULL),
  ('MATHS135', 'compulsory', NULL),
  ('APHYS111', 'elective',   'Year-1-General--Engineering-Science'),
  ('CHEMY100', 'elective',   'Year-1-General--Engineering-Science'),
  ('CHEMY101', 'elective',   'Year-1-General--Engineering-Science'),
  ('CHEMY102', 'elective',   'Year-1-General--Engineering-Science'),
  ('CSMAX175', 'elective',   'Year-1-General--Engineering-Science'),
  ('ENGEN110', 'elective',   'Year-1-General--Engineering-Science'),
  ('ENGEN111', 'elective',   'Year-1-General--Engineering-Science'),
  ('ENGEN112', 'elective',   'Year-1-General--Engineering-Science'),
  ('PHYSC100', 'elective',   'Year-1-General--Engineering-Science'),
  ('DATAX121', 'elective',   'Year-1-General--Engineering-Science'),
  ('DATAX111', 'elective',   'Year-1-General--Engineering-Science'),
  ('COMPX171', 'elective',   'Year-1-General--Engineering-Science'),
  ('COMPX225', 'compulsory', NULL),
  ('COMPX230', 'compulsory', NULL),
  ('COMPX234', 'compulsory', NULL),
  ('COMPX241', 'compulsory', NULL),
  ('COMPX242', 'compulsory', NULL),
  ('ENGEN270', 'compulsory', NULL),
  ('ENGEN271', 'compulsory', NULL),
  ('ENGEN201', 'elective',   'Year-2-Intermediate-Mathematics'),
  ('MATHS201', 'elective',   'Year-2-Intermediate-Mathematics'),
  ('MATHS202', 'elective',   'Year-2-Intermediate-Mathematics'),
  ('MATHS203', 'elective',   'Year-2-Intermediate-Mathematics'),
  ('MATHS235', 'elective',   'Year-2-Intermediate-Mathematics'),
  ('DATAX201', 'elective',   'Year-2-Intermediate-Mathematics'),
  ('DATAX221', 'elective',   'Year-2-Intermediate-Mathematics'),
  ('DATAX222', 'elective',   'Year-2-Intermediate-Mathematics'),
  ('COMPX216', 'elective',   'Year-2-General-Computing'),
  ('COMPX235', 'elective',   'Year-2-General-Computing'),
  ('COMPX271', 'elective',   'Year-2-General-Computing'),
  ('COMPX278', 'elective',   'Year-2-General-Computing'),
  ('ENGEE281', 'elective',   'Year-2-General-Computing'),
  ('ENGEN272', 'compulsory', 'Year-2-OR-choice'),
  ('COMPX301', 'compulsory', NULL),
  ('COMPX324', 'compulsory', NULL),
  ('COMPX341', 'compulsory', NULL),
  ('COMPX361', 'compulsory', NULL),
  ('COMPX374', 'compulsory', NULL),
  ('ENGEN370', 'compulsory', NULL),
  ('ENGEN371', 'compulsory', NULL),
  ('COMPX307', 'elective',   'Year-3-Advanced-Computing'),
  ('COMPX310', 'elective',   'Year-3-Advanced-Computing'),
  ('COMPX316', 'elective',   'Year-3-Advanced-Computing'),
  ('COMPX322', 'elective',   'Year-3-Advanced-Computing'),
  ('COMPX323', 'elective',   'Year-3-Advanced-Computing'),
  ('COMPX326', 'elective',   'Year-3-Advanced-Computing'),
  ('COMPX328', 'elective',   'Year-3-Advanced-Computing'),
  ('COMPX349', 'elective',   'Year-3-Advanced-Computing'),
  ('COMPX364', 'elective',   'Year-3-Advanced-Computing'),
  ('COMPX367', 'elective',   'Year-3-Advanced-Computing'),
  ('ENGEE319', 'elective',   'Year-3-Advanced-Computing'),
  ('ENGEN372', 'compulsory', 'Year-3-OR-choice'),
  ('ENGEN570', 'compulsory', NULL),
  ('ENGEN582', 'compulsory', NULL),
  ('COMPX508', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX517', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX526', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX527', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX529', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX532', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX535', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX539', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX551', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX552', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX553', 'elective',   'Year-4-Specialised-Software-Engineering-Design'),
  ('COMPX554', 'elective',   'Year-4-Specialised-Software-Engineering-Design')
) AS v(paper_code, role, elective_group)
WHERE d.code = 'BE-SE'
ON CONFLICT (degree_id, paper_code) DO NOTHING;

COMMIT;
