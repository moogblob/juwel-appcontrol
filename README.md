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

node bin/juwel.ts on <deviceId> --brightness 80 --rgb 255,200,100 --white 128
node bin/juwel.ts off <deviceId>
node bin/juwel.ts auto <deviceId>   # resume the automatic schedule
```

## As a library

```ts
import { JuwelCloud } from "./src/client.ts";

const cloud = new JuwelCloud({ email, password });
await cloud.login();
const settings = await cloud.getSettings();

const id = settings.devices[0].cloudDeviceId;
await cloud.turnOn(id, { brightnessPct: 80 });  // pauses the schedule if it is running
await cloud.turnOff(id);
await cloud.resumeSchedule(id);                 // back to automatic mode
```

While the schedule runs the lamp ignores manual commands, exactly like the app. `turnOn`,
`turnOff` and `setManual` therefore pause the schedule first (preview mode, 1 hour).
Use `resumeSchedule` or `juwel auto` to return to the stored daily cycle.
