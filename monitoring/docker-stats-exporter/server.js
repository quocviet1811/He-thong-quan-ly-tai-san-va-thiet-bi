"use strict";

const http = require("node:http");

const snapshotUrl =
  process.env.DOCKER_STATS_URL ||
  "http://docker-stats-gateway:9101/snapshot";
const port = Number.parseInt(process.env.PORT || "9100", 10);

function escapeLabel(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function metricLabels(container) {
  return `{project="${escapeLabel(container.project)}",service="${escapeLabel(
    container.service,
  )}",container="${escapeLabel(container.name)}",container_id="${escapeLabel(
    container.id,
  )}"}`;
}

function createMetrics(containers) {
  const lines = [
    "# HELP asset16_container_cpu_usage_seconds_total Cumulative CPU time from Docker Engine container stats.",
    "# TYPE asset16_container_cpu_usage_seconds_total counter",
    "# HELP asset16_container_memory_usage_bytes Current memory usage reported by Docker Engine.",
    "# TYPE asset16_container_memory_usage_bytes gauge",
    "# HELP asset16_container_scrape_success Whether Docker Engine returned valid CPU and memory stats for the container.",
    "# TYPE asset16_container_scrape_success gauge",
  ];

  for (const container of containers) {
    if (container.project !== "asset-management-16") {
      continue;
    }

    const labels = metricLabels(container);
    lines.push(
      `asset16_container_scrape_success${labels} ${
        container.scrapeSuccess === true ? 1 : 0
      }`,
    );

    if (container.scrapeSuccess !== true) {
      continue;
    }

    if (
      Number.isFinite(container.cpuUsageSeconds) &&
      container.cpuUsageSeconds >= 0
    ) {
      lines.push(
        `asset16_container_cpu_usage_seconds_total${labels} ${container.cpuUsageSeconds}`,
      );
    }
    if (
      Number.isFinite(container.memoryUsageBytes) &&
      container.memoryUsageBytes >= 0
    ) {
      lines.push(
        `asset16_container_memory_usage_bytes${labels} ${container.memoryUsageBytes}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

async function readSnapshot() {
  const response = await fetch(snapshotUrl, {
    method: "GET",
    signal: AbortSignal.timeout(9000),
  });

  if (!response.ok) {
    throw new Error(`Docker stats gateway returned HTTP ${response.status}`);
  }

  const containers = await response.json();
  if (!Array.isArray(containers)) {
    throw new Error("Docker stats gateway returned invalid data");
  }

  return containers;
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET") {
    response.writeHead(405, { allow: "GET" });
    response.end("method not allowed\n");
    return;
  }

  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("ok\n");
    return;
  }

  if (request.url !== "/metrics") {
    response.writeHead(404);
    response.end("not found\n");
    return;
  }

  try {
    const metrics = createMetrics(await readSnapshot());
    response.writeHead(200, {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(metrics);
  } catch (error) {
    console.error(`Metrics collection failed: ${error.message}`);
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("metrics collection failed\n");
  }
});

server.listen(port, "0.0.0.0");
