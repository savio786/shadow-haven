// Runs every test file. The end-to-end ones need a running server: npm run dev:test
// (rate limits off so the tests can open many rooms). The soak test is separate: npm run test:soak
await import("./bots.unit.mjs");
await import("./minds.unit.mjs");
await import("./chronicle.unit.mjs");
await import("./lobby.test.mjs");
await import("./roles.test.mjs");
await import("./harbor.test.mjs");
await import("./tasks.test.mjs");
await import("./snuff.test.mjs");
await import("./meeting.test.mjs");
await import("./fog.test.mjs");
await import("./end.test.mjs");
await import("./hardening.test.mjs");
process.exit(process.exitCode ?? 0);
