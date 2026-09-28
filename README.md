# juwel-appcontrol (Node.js / TypeScript)

Minimal TypeScript client (no runtime dependencies) for the MyJUWEL / qconnex cloud API that
JUWEL AppControl devices (HeliaLux, SmartFeed, EccoFlow) talk to.

The endpoints are ported from the Python Home Assistant integration
[Melle79/juwel-appcontrol](https://github.com/Melle79/juwel-appcontrol).

## Requirements

Node.js 22.18 or newer. The `.ts` files run directly via Node's native type stripping, so there is no build step. `fetch` is built in.

## Setup

```bash
cp .env.example .env   # then edit with your MyJUWEL email and password
```

## Usage

```bash
npm install            # dev deps only (typescript, @types/node)
npm run typecheck      # tsc --noEmit

npm run connect                     # log in and confirm the connection
npm run devices                     # dump account settings incl. devices
node bin/juwel.ts state <deviceId>  # current state of one device
node bin/juwel.ts presets           # lighting profiles
node bin/juwel.ts feeder            # feeding plans (SmartFeed)
node bin/juwel.ts config <productId> # trait catalogue, e.g. @juwel.lighting.helialux1
```

## As a library

```ts
import { JuwelCloud } from "./src/client.ts";

const cloud = new JuwelCloud({ email, password });
await cloud.login();
const settings = await cloud.getSettings();
```
