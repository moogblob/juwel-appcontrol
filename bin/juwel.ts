#!/usr/bin/env node
/**
 * CLI for the MyJUWEL cloud.
 *
 *   JUWEL_EMAIL=... JUWEL_PASSWORD=... node bin/juwel.ts connect
 *   node bin/juwel.ts devices
 *   node bin/juwel.ts state <cloudDeviceId>
 *   node bin/juwel.ts presets | feeder | config <productId>
 *
 * Credentials are read from JUWEL_EMAIL / JUWEL_PASSWORD, or from a .env
 * file in the project root (never committed).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JuwelCloud, JuwelAuthError } from "../src/client.ts";

function loadDotEnv(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    for (const line of readFileSync(resolve(root, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env file, that's fine */
  }
}

const SECRET_KEYS = new Set(["aesKey", "accessToken", "password"]);

/** Pretty-print JSON, masking device secrets so they don't end up in terminals or logs. */
function print(value: unknown): void {
  console.log(
    JSON.stringify(value, (key, v) => (SECRET_KEYS.has(key) && typeof v === "string" ? "***" : v), 2),
  );
}

async function main(): Promise<void> {
  loadDotEnv();
  const [command = "connect", ...args] = process.argv.slice(2);
  const email = process.env.JUWEL_EMAIL;
  const password = process.env.JUWEL_PASSWORD;

  if (!email || !password) {
    console.error("Set JUWEL_EMAIL and JUWEL_PASSWORD (env vars or .env file).");
    process.exit(2);
  }

  const cloud = new JuwelCloud({ email, password });

  switch (command) {
    case "connect":
      await cloud.login();
      console.log(`Connected to MyJUWEL cloud as ${email}`);
      break;
    case "devices":
      print(await cloud.getSettings());
      break;
    case "state": {
      const [id] = args;
      if (!id) throw new Error("usage: juwel state <cloudDeviceId>");
      print(await cloud.getState(id));
      break;
    }
    case "presets":
      print(await cloud.getPresets());
      break;
    case "feeder":
      print(await cloud.getFeederPresets());
      break;
    case "config": {
      const [productId] = args;
      if (!productId) throw new Error("usage: juwel config <productId>   e.g. @juwel.lighting.helialux1");
      print(await cloud.getProductConfig(productId));
      break;
    }
    default:
      console.error(
        `Unknown command "${command}". Use: connect | devices | state <id> | presets | feeder | config <productId>`,
      );
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  if (err instanceof JuwelAuthError) {
    console.error(`Login failed: ${err.message}`);
    process.exit(1);
  }
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
