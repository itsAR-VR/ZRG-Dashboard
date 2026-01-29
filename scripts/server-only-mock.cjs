// Preload script for CLI scripts that import Next.js server modules
// This file is loaded via --require before the main script
//
// It does two things:
// 1. Loads environment variables from .env.local and .env
// 2. Mocks the "server-only" module so it doesn't throw

// Load env vars FIRST, before any modules initialize
require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env" });

// Mock server-only module
const Module = require("module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === "server-only") {
    return {}; // Return empty object instead of throwing
  }
  return originalRequire.apply(this, arguments);
};
