#!/usr/bin/env node
/**
 * CLI for the MyJUWEL cloud.
 *
 *   JUWEL_EMAIL=... JUWEL_PASSWORD=... node bin/juwel.ts connect
 *   node bin/juwel.ts devices
 *   node bin/juwel.ts state <cloudDeviceId>
 *   node bin/juwel.ts presets | feeder | config <productId>
 *   node bin/juwel.ts on <cloudDeviceId> [--brightness 80] [--rgb 100,80,40] [--white 50]
 *                                        [--red 100] [--green 80] [--blue 40]   # all values 0..100
 *   node bin/juwel.ts off <cloudDeviceId>
 *   node bin/juwel.ts auto <cloudDeviceId>      # back to the schedule
 *
 * Credentials are read from JUWEL_EMAIL / JUWEL_PASSWORD, or from a .env
 * file in the project root (never committed).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JuwelCloud, JuwelAuthError, type ChannelValues } from "../src/client.ts";

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

/** Parse `--key value` pairs from args; positional args are returned separately. */
function parseArgs(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const value = args[i + 1];
      if (value === undefined) throw new Error(`missing value for ${a}`);
      flags[a.slice(2)] = value;
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function requirePct(text: string, flag: string): number {
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`--${flag} expects a percentage 0..100, got "${text}"`);
  return n;
}

/** Channel levels from --rgb r,g,b and/or --red/--green/--blue/--white, all 0..100. */
function parseChannels(flags: Record<string, string>): Partial<ChannelValues> | undefined {
  const ch: Partial<ChannelValues> = {};
  if (flags.rgb !== undefined) {
    const parts = flags.rgb.split(",");
    if (parts.length !== 3) throw new Error(`--rgb expects "r,g,b" with values 0..100, got "${flags.rgb}"`);
    [ch.red, ch.green, ch.blue] = parts.map((t) => requirePct(t.trim(), "rgb")) as [number, number, number];
  }
  for (const name of ["red", "green", "blue", "white"] as const) {
    if (flags[name] !== undefined) ch[name] = requirePct(flags[name], name);
  }
  return Object.keys(ch).length > 0 ? ch : undefined;
}

async function main(): Promise<void> {
  loadDotEnv();
  const [command = "connect", ...rawArgs] = process.argv.slice(2);
  const { positional: args, flags } = parseArgs(rawArgs);
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
    case "on": {
      const [id] = args;
      if (!id) {
        throw new Error(
          "usage: juwel on <cloudDeviceId> [--brightness 0-100] [--rgb r,g,b] [--red|--green|--blue|--white 0-100]",
        );
      }
      await cloud.turnOn(id, {
        brightness: flags.brightness !== undefined ? requirePct(flags.brightness, "brightness") : undefined,
        channels: parseChannels(flags),
      });
      console.log("Light on (schedule paused for 1 h if it was running)");
      break;
    }
    case "off": {
      const [id] = args;
      if (!id) throw new Error("usage: juwel off <cloudDeviceId>");
      await cloud.turnOff(id);
      console.log("Light off (schedule paused for 1 h if it was running)");
      break;
    }
    case "auto": {
      const [id] = args;
      if (!id) throw new Error("usage: juwel auto <cloudDeviceId>");
      await cloud.resumeSchedule(id);
      console.log("Schedule resumed");
      break;
    }
    default:
      console.error(
        `Unknown command "${command}". Use: connect | devices | state <id> | presets | feeder | config <productId> | on <id> | off <id> | auto <id>`,
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
