#!/usr/bin/env node

/**
 * SolAegis CLI — Global command launcher.
 * This wrapper uses tsx to run the TypeScript CLI entry point.
 */

import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.join(__dirname, "cli", "index.ts");

const result = spawnSync("npx", ["tsx", cliPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    cwd: __dirname,
    shell: true,
});

process.exit(result.status ?? 1);
