#!/usr/bin/env node
/**
 * Reads migrations/data/projects.csv, fetches elevation from two sources:
 *   1. Open Elevation (SRTM-based)  – batch POST
 *   2. Cesium World Terrain         – sampleTerrainMostDetailed
 * Then writes migrations/output/projects_with_elevation.json with every original
 * field plus open_elevation_alt, cesium_alt, and elevation_diff (open – cesium).
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
const ELEVATION_API =
  "https://open-elevation.core.dasiot.site/api/v1/lookup";

// ── CSV parsing ──────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.split("\n").filter((l) => l.trim());
  const headers = splitCSVLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = splitCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

function splitCSVLine(line) {
  const result = [];
  let inQuote = false;
  let current = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
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

// ── Open Elevation (batch) ───────────────────────────────────────────────────

async function fetchOpenElevation(locations) {
  // locations: [{latitude, longitude}]
  const res = await fetch(ELEVATION_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locations }),
  });

  if (!res.ok) {
    throw new Error(`Open Elevation API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  // response: { results: [{latitude, longitude, elevation}] }
  return json.results.map((r) => r.elevation);
}

// ── Cesium World Terrain ─────────────────────────────────────────────────────

async function buildCesiumProvider() {
  const token = process.env.CESIUM_ION_TOKEN;
  if (!token) {
    throw new Error(
      "CESIUM_ION_TOKEN env var is required to query Cesium World Terrain"
    );
  } else {
    console.log("Using Cesium Ion token:", token.slice(0, 4) + "…");
  }
  Ion.defaultAccessToken = token;
  return CesiumTerrainProvider.fromIonAssetId(1);
}

async function fetchCesiumElevations(terrainProvider, coords) {
  // coords: [{lon, lat}]
  // sampleTerrainMostDetailed mutates positions in-place
  const positions = coords.map(({ lon, lat }) =>
    Cartographic.fromDegrees(lon, lat)
  );
  await sampleTerrainMostDetailed(terrainProvider, positions);
  return positions.map((p) => p.height);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseCenter(raw) {
  // raw looks like: [114.194, 22.342]
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [lon, lat] = parsed.map(Number);
      return { lon, lat };
    }
  } catch {
    // fall through
  }
  return null;
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Use env var NODE_ENV=prod for production data (currently ${process.env.NODE_ENV || "dev"})`);
  const environment = process.env.NODE_ENV || "dev";
  const fileName = environment === "prod" ? "projects_prod.csv" : "projects_dev.csv";
  console.log(`Loading data from ${fileName}…`);
  const csvText = readFileSync(join(DATA_DIR, fileName), "utf8");
  const rows = parseCSV(csvText);

  // Parse center coordinates
  const projects = rows.map((row) => ({
    ...row,
    _center: parseCenter(row.center),
  }));

  const withCoords = projects.filter((p) => p._center !== null);
  console.log(
    `Loaded ${projects.length} projects, ${withCoords.length} with valid center`
  );

  // ── Step 1: Open Elevation (single batch request) ──────────────────────────
  console.log("Fetching Open Elevation data…");
  const openElevLocations = withCoords.map(({ _center }) => ({
    latitude: _center.lat,
    longitude: _center.lon,
  }));

  const openElevAlts = await fetchOpenElevation(openElevLocations);
  console.log(`  Got ${openElevAlts.length} Open Elevation values`);

  // ── Step 2: Cesium World Terrain ───────────────────────────────────────────
  console.log("Connecting to Cesium World Terrain…");
  const terrainProvider = await buildCesiumProvider();

  // Cesium recommends batches of ~100 positions
  const cesiumAlts = [];
  const coordChunks = chunk(
    withCoords.map((p) => p._center),
    100
  );

  for (let i = 0; i < coordChunks.length; i++) {
    process.stdout.write(
      `  Cesium batch ${i + 1}/${coordChunks.length}…\r`
    );
    const alts = await fetchCesiumElevations(terrainProvider, coordChunks[i]);
    cesiumAlts.push(...alts);
  }
  console.log(`\n  Got ${cesiumAlts.length} Cesium elevation values`);

  // ── Step 3: Build output ───────────────────────────────────────────────────
  const output = projects.map((project) => {
    const { _center, ...rest } = project;

    if (!_center) {
      return { ...rest, open_elevation_alt: null, cesium_alt: null, elevation_diff: null };
    }

    const idx = withCoords.indexOf(project);
    const openAlt = openElevAlts[idx] ?? null;
    const cesiumAlt = cesiumAlts[idx] ?? null;
    const diff =
      openAlt !== null && cesiumAlt !== null
        ? parseFloat((openAlt - cesiumAlt).toFixed(4))
        : null;

    return {
      ...rest,
      open_elevation_alt: openAlt,
      cesium_alt: cesiumAlt !== null ? parseFloat(cesiumAlt.toFixed(4)) : null,
      elevation_diff: diff,
    };
  });

  // ── Step 4: Write output ───────────────────────────────────────────────────
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, "projects_with_elevation.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2), "utf8");

  console.log(`\nWrote ${output.length} records to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// NODE_ENV=dev node migrations/scripts/csv-to-json.js