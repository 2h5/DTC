"use strict";

const { createApplication } = require("./src/app");
const { createLogger } = require("./src/logger");

async function main() {
  const logger = createLogger();
  try {
    const { app, config } = await createApplication({ logger });
    const server = app.listen(config.port, () => {
      logger.info("server_started", {
        port: config.port,
        mode: config.mode,
        createEnabled: config.active && config.createEnabled,
      });
    });
    server.requestTimeout = 15_000;
    server.headersTimeout = 10_000;
    server.keepAliveTimeout = 5_000;

    const shutdown = (signal) => {
      logger.info("server_shutdown_requested", { signal });
      server.close((error) => {
        if (error) {
          logger.error("server_shutdown_failed", { errorType: error.name });
          process.exitCode = 1;
        }
      });
    };
    process.once("SIGTERM", () => shutdown("SIGTERM"));
    process.once("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    logger.error("server_start_failed", { errorType: error.name, reason: error.message });
    process.exitCode = 1;
  }
}

if (require.main === module) void main();

module.exports = { main };
