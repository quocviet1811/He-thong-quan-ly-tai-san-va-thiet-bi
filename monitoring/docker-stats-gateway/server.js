"use strict";

const http = require("node:http");

const projectName = process.env.COMPOSE_PROJECT_NAME || "asset-management-16";
const dockerProxyUrl = process.env.DOCKER_PROXY_URL || "http://docker-socket-proxy:2375";
const port = Number.parseInt(process.env.PORT || "9101", 10);
const dockerRequestTimeoutMs = 5000;

async function dockerGet(path) {
  const response = await fetch(new URL(path, dockerProxyUrl), {
    method: "GET",
    signal: AbortSignal.timeout(dockerRequestTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Docker API returned HTTP ${response.status}`);
  }

  return response.json();
}

async function listProjectContainers() {
  const filters = encodeURIComponent(
    JSON.stringify({ label: [`com.docker.compose.project=${projectName}`] }),
  );
  const containers = await dockerGet(`/containers/json?filters=${filters}`);

  if (!Array.isArray(containers)) {
    throw new Error("Docker API returned an invalid container list");
  }

  return containers
    .filter(
      (container) =>
        container.Labels?.["com.docker.compose.project"] === projectName &&
        /^[a-f0-9]{64}$/i.test(container.Id || ""),
    )
    .map((container) => ({
      id: container.Id,
      project: projectName,
      service: container.Labels["com.docker.compose.service"] || "unknown",
      name: (container.Names || [])[0]?.replace(/^\/+/, "") || container.Id.slice(0, 12),
    }));
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

async function readContainerStats(container) {
  const stats = await dockerGet(`/containers/${container.id}/stats?stream=false`);
  const cpuNanoseconds = nonNegativeNumber(
    stats.cpu_stats?.cpu_usage?.total_usage,
  );
  const memoryUsageBytes = nonNegativeNumber(stats.memory_stats?.usage);

  if (cpuNanoseconds === null || memoryUsageBytes === null) {
    throw new Error("Docker API returned incomplete CPU or memory stats");
  }

  return {
    ...container,
    cpuUsageSeconds: cpuNanoseconds / 1_000_000_000,
    memoryUsageBytes,
    scrapeSuccess: true,
  };
}

async function createSnapshot() {
  const containers = await listProjectContainers();

  return Promise.all(
    containers.map(async (container) => {
      try {
        return await readContainerStats(container);
      } catch (error) {
        console.error(
          `Stats request failed for service ${container.service}: ${error.message}`,
        );
        return { ...container, scrapeSuccess: false };
      }
    }),
  );
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

const server = http.createServer(async (request, response) => {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  if (request.url === "/health") {
    sendJson(response, 200, { status: "ok" });
    return;
  }

  if (request.url !== "/snapshot") {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  try {
    sendJson(response, 200, await createSnapshot());
  } catch (error) {
    console.error(`Docker stats snapshot failed: ${error.message}`);
    sendJson(response, 502, { error: "Docker stats API unavailable" });
  }
});

server.listen(port, "0.0.0.0");
