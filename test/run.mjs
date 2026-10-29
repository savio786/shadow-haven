// Runs every end-to-end test file against a running server (npm run dev).
await import("./lobby.test.mjs");
await import("./roles.test.mjs");
process.exit(process.exitCode ?? 0);
