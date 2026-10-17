import { startServer } from "./server.js";

void startServer().then((app) => {
  app.log.info("Garbage-CD controller listening on loopback");
}).catch((error: unknown) => {
  console.error("Unable to start Garbage-CD controller:", error);
  process.exitCode = 1;
});
