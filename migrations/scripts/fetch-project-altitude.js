#!/usr/bin/env node
/**
 * Reads migrations/data/projects_{env}.csv, fetches altitude per project:
 *   1. Try Cesium World Terrain first
 *   2. Fallback to Open Elevation if Cesium fails (any error / 502 / 403)
 *
 * Writes two files:
 *   output/projects_altitude.json            – Map<project_id, { geoVendor, altitude }>
 *   output/migrate_projects.sql              – UPDATE projects SET altitude, geo_vendor
 *   output/revert_migrate_projects.sql       – SET altitude = NULL, geo_vendor = NULL
 *
 * Required env var:
 *   CESIUM_ION_TOKEN  – Cesium Ion access token for World Terrain (asset 1)
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  Ion,
  CesiumTerrainProvider,
  Cartographic,
  sampleTerrainMostDetailed,
} from "cesium";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../input");
const OUT_DIR = join(__dirname, "../output");
const ELEVATION_API = "https://open-elevation.core.dasiot.site/api/v1/lookup";

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCSVLine(line);
    return Object.fromEntries(
      headers.map((h, i) => [h.trim(), values[i] ?? ""]),
    );
  });
}

function splitCSVLine(line) {
  const result = [];
  let inQuote = false;
  let current = "";
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCenter(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [lon, lat] = parsed.map(Number);
      if (isFinite(lon) && isFinite(lat)) return { lon, lat };
    }
  } catch {
    // fall through
  }
  return null;
}

// ── Cesium ────────────────────────────────────────────────────────────────────

let _terrainProvider = null;

async function buildCesiumProvider() {
  if (_terrainProvider) return _terrainProvider;
  const token = process.env.CESIUM_ION_TOKEN;
  if (!token) throw new Error("CESIUM_ION_TOKEN env var is required");
  console.log("Using Cesium Ion token:", token.slice(0, 4) + "…");
  Ion.defaultAccessToken = token;
  _terrainProvider = await CesiumTerrainProvider.fromIonAssetId(1);
  return _terrainProvider;
}

async function getFromCesium(project) {
  try {
    const provider = await buildCesiumProvider();
    const position = Cartographic.fromDegrees(
      project._center.lon,
      project._center.lat,
    );
    await sampleTerrainMostDetailed(provider, [position]);
    const altitude = position.height;
    if (altitude == null || !isFinite(altitude)) return null;
    return { geoVendor: "cesium", altitude: parseFloat(altitude.toFixed(4)) };
  } catch (err) {
    console.warn(`  Cesium failed for ${project.id}: ${err.message}`);
    return null;
  }
}

// ── Open Elevation ────────────────────────────────────────────────────────────

async function getFromElevation(project) {
  try {
    const res = await fetch(ELEVATION_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locations: [
          { latitude: project._center.lat, longitude: project._center.lon },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    const altitude = json.results?.[0]?.elevation;
    if (altitude == null || !isFinite(altitude)) return null;
    return {
      geoVendor: "openelevation",
      altitude: parseFloat(altitude.toFixed(4)),
    };
  } catch (err) {
    console.warn(`  OpenElevation failed for ${project.id}: ${err.message}`);
    return null;
  }
}

// ── Vendor fallback ───────────────────────────────────────────────────────────

async function getFromOneOfVendor(project) {
  const r = await getFromCesium(project);
  if (r) return r;
  const r2 = await getFromElevation(project);
  if (r2) return r2;
  return null;
}

// ── SQL generation ────────────────────────────────────────────────────────────

function buildMigrateSql(resultMap, projectCount, generated) {
  const mapJson = JSON.stringify(
    Object.fromEntries(
      Object.entries(resultMap).map(([id, v]) => [
        id,
        { altitude: v.altitude, geo_vendor: v.geoVendor },
      ]),
    ),
    null,
    2,
  );

  return `-- =============================================================
-- Migration: set projects.altitude and projects.geo_vendor
-- Projects:  ${projectCount}
-- Generated: ${generated}
-- =============================================================
-- Run: psql $POSTGRES_URL_PROJECT -f migrate_projects.sql
-- =============================================================

DO $$
DECLARE
  project_map jsonb := '${mapJson}'::jsonb;
  proj_id     uuid;
  entry       jsonb;
BEGIN
  FOR proj_id, entry IN
    SELECT key::uuid, value
    FROM jsonb_each(project_map)
  LOOP
    BEGIN
      UPDATE projects
      SET altitude   = (entry->>'altitude')::float,
          geo_vendor = (entry->>'geo_vendor')::\"GeoVendor\"
      WHERE id = proj_id;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'projects migration failed for %, rolling back: %', proj_id, SQLERRM;
      RAISE;
    END;

    PERFORM pg_sleep(0.05);
  END LOOP;
END $$;
`;
}

function buildRevertSql(resultMap, projectCount, generated) {
  const ids = Object.keys(resultMap);
  const idsJson = JSON.stringify(ids, null, 2);

  return `-- =============================================================
-- REVERT: set projects.altitude = NULL, geo_vendor = NULL
-- Projects:  ${projectCount}
-- Generated: ${generated}
-- =============================================================
-- Run: psql $POSTGRES_URL_PROJECT -f revert_migrate_projects.sql
-- =============================================================

DO $$
DECLARE
  project_ids jsonb := '${idsJson}'::jsonb;
  proj_id     uuid;
BEGIN
  FOR proj_id IN
    SELECT value::uuid
    FROM jsonb_array_elements_text(project_ids)
  LOOP
    BEGIN
      UPDATE projects
      SET altitude   = NULL,
          geo_vendor = NULL
      WHERE id = proj_id;

    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'projects revert failed for %, rolling back: %', proj_id, SQLERRM;
      RAISE;
    END;

    PERFORM pg_sleep(0.05);
  END LOOP;
END $$;
`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const environment = process.env.NODE_ENV || "dev";
  const fileName =
    environment === "prod" ? "projects_prod.csv" : "projects_dev.csv";
  console.log(`Loading ${fileName} (NODE_ENV=${environment})…`);

  const csvText = readFileSync(join(DATA_DIR, fileName), "utf8");
  const rows = parseCSV(csvText);

  const projects = rows
    .map((row) => ({ ...row, _center: parseCenter(row.center) }))
    .filter((p) => {
      if (!p._center) {
        console.warn(`  Skipping ${p.id}: no valid center`);
        return false;
      }
      return true;
    });

  console.log(`${projects.length} projects with valid center`);

  // Per-project fallback fetch
  const resultMap = {};
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    process.stdout.write(`  [${i + 1}/${projects.length}] ${project.id}…\r`);
    const result = await getFromOneOfVendor(project);
    if (result) {
      resultMap[project.id] = result;
    } else {
      console.warn(`\n  No altitude for ${project.id} — skipped`);
    }
  }

  console.log(
    `\nFetched altitude for ${Object.keys(resultMap).length} projects`,
  );

  // Vendor breakdown
  const byVendor = Object.values(resultMap).reduce((acc, v) => {
    acc[v.geoVendor] = (acc[v.geoVendor] ?? 0) + 1;
    return acc;
  }, {});
  console.log("By vendor:", byVendor);

  mkdirSync(OUT_DIR, { recursive: true });
  const generated = new Date().toISOString();
  const projectCount = Object.keys(resultMap).length;

  // JSON output
  const jsonPath = join(OUT_DIR, "projects_altitude.json");
  writeFileSync(jsonPath, JSON.stringify(resultMap, null, 2), "utf8");
  console.log(`Written: ${jsonPath}`);

  // SQL outputs
  const migratePath = join(OUT_DIR, "migrate_projects.sql");
  const revertPath = join(OUT_DIR, "revert_migrate_projects.sql");

  writeFileSync(
    migratePath,
    buildMigrateSql(resultMap, projectCount, generated),
    "utf8",
  );
  writeFileSync(
    revertPath,
    buildRevertSql(resultMap, projectCount, generated),
    "utf8",
  );

  console.log(`Written: ${migratePath}`);
  console.log(`Written: ${revertPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
