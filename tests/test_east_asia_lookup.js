#!/usr/bin/env node

const http = require("http");
const https = require("https");

const baseUrl = process.env.OPEN_ELEVATION_BASE_URL || "http://127.0.0.1:8080";
const lookupUrl = new URL("/api/v1/lookup", baseUrl);

const testCases = [
  {
    name: "Hong Kong - Victoria Peak",
    country: "HK",
    latitude: 22.2758,
    longitude: 114.1455,
    minElevation: 300,
    maxElevation: 700,
  },
  {
    name: "Hong Kong - Tai Mo Shan",
    country: "HK",
    latitude: 22.4107,
    longitude: 114.1246,
    minElevation: 700,
    maxElevation: 1100,
  },
  {
    name: "Taiwan - Taipei 101",
    country: "TW",
    latitude: 25.0339,
    longitude: 121.5645,
    minElevation: 0,
    maxElevation: 100,
  },
  {
    name: "Taiwan - Alishan",
    country: "TW",
    latitude: 23.508,
    longitude: 120.8132,
    minElevation: 1800,
    maxElevation: 2800,
  },
  {
    name: "Japan - Tokyo Tower",
    country: "JP",
    latitude: 35.6586,
    longitude: 139.7454,
    minElevation: 0,
    maxElevation: 100,
  },
  {
    name: "Japan - Mount Fuji",
    country: "JP",
    latitude: 35.3606,
    longitude: 138.7274,
    minElevation: 3000,
    maxElevation: 3900,
  },
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assertClose(actual, expected, tolerance = 0.0001) {
  return Math.abs(actual - expected) <= tolerance;
}

function postLookup(cases) {
  const payload = JSON.stringify({
    locations: cases.map((testCase) => ({
      latitude: testCase.latitude,
      longitude: testCase.longitude,
    })),
  });

  const client = lookupUrl.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(
      lookupUrl,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 30000,
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`invalid JSON response: ${error.message}`));
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy(new Error("request timed out"));
    });

    request.on("error", (error) => {
      reject(new Error(`cannot reach ${lookupUrl.toString()}: ${error.message}`));
    });

    request.write(payload);
    request.end();
  });
}

async function main() {
  const result = await postLookup(testCases).catch((error) => fail(error.message));
  const rows = result.results;

  if (!Array.isArray(rows)) {
    fail("response does not contain a results array");
  }

  if (rows.length !== testCases.length) {
    fail(`expected ${testCases.length} results, got ${rows.length}`);
  }

  console.log(`Testing ${testCases.length} places against ${lookupUrl.toString()}`);

  for (let index = 0; index < testCases.length; index += 1) {
    const testCase = testCases[index];
    const row = rows[index];

    for (const key of ["latitude", "longitude", "elevation"]) {
      if (!(key in row)) {
        fail(`${testCase.name}: missing ${key} in response`);
      }
    }

    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const elevation = Number(row.elevation);

    if (!assertClose(latitude, testCase.latitude)) {
      fail(`${testCase.name}: latitude mismatch, expected ${testCase.latitude}, got ${latitude}`);
    }
    if (!assertClose(longitude, testCase.longitude)) {
      fail(`${testCase.name}: longitude mismatch, expected ${testCase.longitude}, got ${longitude}`);
    }
    if (elevation < testCase.minElevation || elevation > testCase.maxElevation) {
      fail(
        `${testCase.name}: elevation ${elevation} outside expected range ` +
          `${testCase.minElevation}..${testCase.maxElevation}`
      );
    }

    console.log(
      `PASS [${testCase.country}] ${testCase.name}: ` +
        `elevation=${elevation}m expected=${testCase.minElevation}..${testCase.maxElevation}m`
    );
  }

  console.log("All East Asia elevation checks passed.");
}

main();
