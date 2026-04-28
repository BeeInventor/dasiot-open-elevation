import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = join(__dirname, "../output");

const projects = JSON.parse(
  readFileSync(join(outputDir, "projects_with_elevation.json"), "utf-8"),
);

// Build Map<project_id, elevation_diff>
const elevationMap = Object.fromEntries(
  projects
    .filter((p) => p.elevation_diff != null)
    .map((p) => [p.id, p.elevation_diff]),
);

const projectCount = Object.keys(elevationMap).length;
console.log(`Loaded ${projectCount} projects with elevation_diff`);

const mapJson = JSON.stringify(elevationMap, null, 2);
const revertMapJson = JSON.stringify(
  Object.fromEntries(
    Object.entries(elevationMap).map(([id, diff]) => [id, -diff]),
  ),
  null,
  2,
);
const generated = new Date().toISOString();

// ---------------------------------------------------------------------------
// migrate_project_tables.sql  (app-dsm-project DB)
// ---------------------------------------------------------------------------
const projectTablesSql = `-- =============================================================
-- Migration: adjust project_3d_assets.coordinates.alt
--            and project_floorplans.altitude by elevation_diff
-- DB:        app-dsm-project
-- Projects:  ${projectCount}
-- Generated: ${generated}
-- =============================================================
-- Run: psql $POSTGRES_URL_PROJECT -f migrate_project_tables.sql
-- =============================================================

DO $$
DECLARE
  elevation_map jsonb := '${mapJson}'::jsonb;
  proj_id       uuid;
  diff          float;
BEGIN
  FOR proj_id, diff IN
    SELECT key::uuid, value::float
    FROM jsonb_each_text(elevation_map)
  LOOP
    BEGIN
      -- project_3d_assets: skip rows where coordinates or coordinates.alt is null
      UPDATE project_3d_assets
      SET coordinates = jsonb_set(
        coordinates,
        '{alt}',
        to_jsonb((coordinates->>'alt')::float + diff)
      )
      WHERE project_id = proj_id
        AND coordinates IS NOT NULL
        AND coordinates->>'alt' IS NOT NULL;

      -- project_floorplans: altitude is NOT NULL per schema
      UPDATE project_floorplans
      SET altitude = altitude + diff
      WHERE project_id = proj_id;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'project_tables migration failed for project %, rolling back: %', proj_id, SQLERRM;
      RAISE;
    END;

    PERFORM pg_sleep(0.05);
  END LOOP;
END $$;
`;

// ---------------------------------------------------------------------------
// migrate_areas.sql  (app-dsm-area DB)
// ---------------------------------------------------------------------------
const areasSql = `-- =============================================================
-- Migration: adjust areas.altitude by elevation_diff
-- DB:        app-dsm-area
-- Projects:  ${projectCount}  |  Est. rows: ~2471
-- Generated: ${generated}
-- NOTE:      pg_sleep(0.1) between projects to prevent CPU spike
-- =============================================================
-- Run: psql $POSTGRES_URL_AREA -f migrate_areas.sql
-- =============================================================

DO $$
DECLARE
  elevation_map jsonb := '${mapJson}'::jsonb;
  proj_id       uuid;
  diff          float;
BEGIN
  FOR proj_id, diff IN
    SELECT key::uuid, value::float
    FROM jsonb_each_text(elevation_map)
  LOOP
    BEGIN
      UPDATE areas
      SET altitude = altitude + diff
      WHERE project_id = proj_id
        AND altitude IS NOT NULL;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'areas migration failed for project %, rolling back: %', proj_id, SQLERRM;
      RAISE;
    END;

    -- throttle: give postgres WAL writer / autovacuum breathing room
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;
`;

// ---------------------------------------------------------------------------
// revert_migrate_project_tables.sql  (app-dsm-project DB)
// ---------------------------------------------------------------------------
const revertProjectTablesSql = `-- =============================================================
-- REVERT: undo adjust of project_3d_assets.coordinates.alt
--         and project_floorplans.altitude (negated elevation_diff)
-- DB:        app-dsm-project
-- Projects:  ${projectCount}
-- Generated: ${generated}
-- =============================================================
-- Run: psql $POSTGRES_URL_PROJECT -f revert_migrate_project_tables.sql
-- =============================================================

DO $$
DECLARE
  elevation_map jsonb := '${revertMapJson}'::jsonb;
  proj_id       uuid;
  diff          float;
BEGIN
  FOR proj_id, diff IN
    SELECT key::uuid, value::float
    FROM jsonb_each_text(elevation_map)
  LOOP
    BEGIN
      -- project_3d_assets: skip rows where coordinates or coordinates.alt is null
      UPDATE project_3d_assets
      SET coordinates = jsonb_set(
        coordinates,
        '{alt}',
        to_jsonb((coordinates->>'alt')::float + diff)
      )
      WHERE project_id = proj_id
        AND coordinates IS NOT NULL
        AND coordinates->>'alt' IS NOT NULL;

      -- project_floorplans: altitude is NOT NULL per schema
      UPDATE project_floorplans
      SET altitude = altitude + diff
      WHERE project_id = proj_id;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'project_tables revert failed for project %, rolling back: %', proj_id, SQLERRM;
      RAISE;
    END;

    PERFORM pg_sleep(0.05);
  END LOOP;
END $$;
`;

// ---------------------------------------------------------------------------
// revert_migrate_areas.sql  (app-dsm-area DB)
// ---------------------------------------------------------------------------
const revertAreasSql = `-- =============================================================
-- REVERT: undo adjust of areas.altitude (negated elevation_diff)
-- DB:        app-dsm-area
-- Projects:  ${projectCount}  |  Est. rows: ~2471
-- Generated: ${generated}
-- NOTE:      pg_sleep(0.1) between projects to prevent CPU spike
-- =============================================================
-- Run: psql $POSTGRES_URL_AREA -f revert_migrate_areas.sql
-- =============================================================

DO $$
DECLARE
  elevation_map jsonb := '${revertMapJson}'::jsonb;
  proj_id       uuid;
  diff          float;
BEGIN
  FOR proj_id, diff IN
    SELECT key::uuid, value::float
    FROM jsonb_each_text(elevation_map)
  LOOP
    BEGIN
      UPDATE areas
      SET altitude = altitude + diff
      WHERE project_id = proj_id
        AND altitude IS NOT NULL;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'areas revert failed for project %, rolling back: %', proj_id, SQLERRM;
      RAISE;
    END;

    -- throttle: give postgres WAL writer / autovacuum breathing room
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;
`;

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------
const projectTablesPath = join(outputDir, "migrate_project_tables.sql");
const areasPath = join(outputDir, "migrate_areas.sql");
const revertProjectTablesPath = join(
  outputDir,
  "revert_migrate_project_tables.sql",
);
const revertAreasPath = join(outputDir, "revert_migrate_areas.sql");

writeFileSync(projectTablesPath, projectTablesSql, "utf-8");
writeFileSync(areasPath, areasSql, "utf-8");
writeFileSync(revertProjectTablesPath, revertProjectTablesSql, "utf-8");
writeFileSync(revertAreasPath, revertAreasSql, "utf-8");

console.log(`Written: ${projectTablesPath}`);
console.log(`Written: ${areasPath}`);
console.log(`Written: ${revertProjectTablesPath}`);
console.log(`Written: ${revertAreasPath}`);
