// Runs every test file. The end-to-end ones need a running server (npm run dev).
await import("./bots.unit.mjs");
await import("./lobby.test.mjs");
await import("./roles.test.mjs");
await import("./harbor.test.mjs");
await import("./tasks.test.mjs");
await import("./snuff.test.mjs");
process.exit(process.exitCode ?? 0);
