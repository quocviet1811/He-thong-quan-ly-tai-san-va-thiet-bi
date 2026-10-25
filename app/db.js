const { Pool } = require("pg");

const requiredVariables = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"];
const missingVariables = requiredVariables.filter(
    name => !process.env[name]
);

if (missingVariables.length > 0) {
    throw new Error(
        `Missing required PostgreSQL environment variables: ${missingVariables.join(", ")}`
    );
}

const port = Number(process.env.PGPORT || 5432);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PGPORT must be a valid TCP port.");
}

const pool = new Pool({
    host: process.env.PGHOST,
    port,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on("error", error => {
    console.error("Unexpected PostgreSQL pool error.", {
        code: typeof error.code === "string" ? error.code : "UNKNOWN"
    });
});

module.exports = pool;
