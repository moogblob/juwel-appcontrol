/**
 * Minimal client for the MyJUWEL / qconnex cloud API.
 *
 * Endpoints and payload shapes are taken from the Python Home Assistant
 * integration at https://github.com/Melle79/juwel-appcontrol
 * (custom_components/juwel_appcontrol/api.py).
 *
 * Public request/response types live in ./types.ts and are re-exported here.
 */

import type {
  CommandBody,
  DeviceState,
  FeederPreset,
  JuwelCloudOptions,
  ManualLightOptions,
  Preset,
  ProductConfig,
  Settings,
  StatePayload,
} from "./types.ts";

export type * from "./types.ts";

export const API_HOST = "https://app-api.prod.qconnex.io";
export const ENVIRONMENT_NAME = "Juwel";
const TIMEOUT_MS = 20_000;

export class JuwelAuthError extends Error {}
export class JuwelApiError extends Error {}

interface LoginResponse {
  accountToken?: string;
  accessToken?: string;
}

type HttpMethod = "GET" | "POST";

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export class JuwelCloud {
  readonly host: string;
  #email: string;
  #password: string;
  #token: string | null = null;

  constructor(options: JuwelCloudOptions) {
    if (!options.email || !options.password) {
      throw new Error("email and password are required");
    }
    this.#email = options.email;
    this.#password = options.password;
    this.host = options.host ?? API_HOST;
  }

  get isLoggedIn(): boolean {
    return this.#token !== null;
  }

  /** Log in and store the bearer token. Throws JuwelAuthError on bad credentials. */
  async login(): Promise<void> {
    const res = await fetch(`${this.host}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        email: this.#email,
        password: this.#password,
        environmentName: ENVIRONMENT_NAME,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const text = await res.text();
    if (res.status === 200 || res.status === 201) {
      const data = JSON.parse(text) as LoginResponse;
      this.#token = data.accountToken ?? data.accessToken ?? null;
      if (!this.#token) throw new JuwelApiError("Login response contained no token");
      return;
    }
    if (res.status === 401) throw new JuwelAuthError("Email or password is wrong");
    throw new JuwelApiError(`Login HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  async #request<T>(method: HttpMethod, path: string, body?: unknown, retry = true): Promise<T> {
    if (!this.#token) await this.login();

    const res = await fetch(`${this.host}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.#token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 401 && retry) {
      this.#token = null;
      return this.#request<T>(method, path, body, false);
    }

    const text = await res.text();
    if (![200, 201, 202, 204].includes(res.status)) {
      throw new JuwelApiError(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status === 204 || !text) return null as T;
    const type = res.headers.get("content-type") ?? "";
    return (type.includes("application/json") ? JSON.parse(text) : text) as T;
  }

  // ---- read ---------------------------------------------------------

  /** Account settings, including the list of devices. */
  getSettings(): Promise<Settings> {
    return this.#request<Settings>("GET", "/settings");
  }

  /** All lighting profiles including their daily curve (timeEvents). */
  getPresets(): Promise<Preset[]> {
    return this.#request<Preset[]>("GET", "/presets");
  }

  /** Feeding plans for SmartFeed devices. */
  getFeederPresets(): Promise<FeederPreset[]> {
    return this.#request<FeederPreset[]>("GET", "/presets/feeder");
  }

  /** Create or overwrite one feeding plan. The cloud answers 204 with no body. */
  saveFeederPreset(preset: FeederPreset): Promise<null> {
    return this.#request<null>("POST", "/presets/feeder", preset);
  }

  /** Capability description (traits) of a product, e.g. "@juwel.lighting.helialux1". */
  getProductConfig(productId: string): Promise<ProductConfig> {
    return this.#request<ProductConfig>("GET", `/config/product/${encodeURIComponent(productId)}`);
  }

  /** Current state of one device. */
  getState(cloudDeviceId: string): Promise<DeviceState> {
    return this.#request<DeviceState>("GET", `/device/${encodeURIComponent(cloudDeviceId)}/state`);
  }

  // ---- write --------------------------------------------------------

  /** Set one or more state fields: { msg_key: value, ... } */
  setState(cloudDeviceId: string, fields: StatePayload): Promise<unknown> {
    return this.#request<unknown>("POST", `/device/${encodeURIComponent(cloudDeviceId)}/state`, {
      payload: { type: "request", ...fields },
    });
  }

  command(cloudDeviceId: string, body: CommandBody): Promise<unknown> {
    return this.#request<unknown>("POST", `/device/${encodeURIComponent(cloudDeviceId)}/command`, body);
  }

  /** Pause the schedule (manual / preview mode) for `timeout` seconds. */
  pauseSchedule(cloudDeviceId: string, timeout = 3600): Promise<unknown> {
    return this.command(cloudDeviceId, { type: "preset", action: "pause", timeout });
  }

  /** Resume the automatic schedule. */
  resumeSchedule(cloudDeviceId: string): Promise<unknown> {
    return this.command(cloudDeviceId, { type: "preset", action: "resume" });
  }

  // ---- light convenience -------------------------------------------

  /**
   * Set manual light values. While the schedule runs (mode "auto") the lamp
   * ignores manual writes, so the schedule is paused first (preview mode,
   * default 1 h), exactly as the app does. Pass `currentMode` if you already
   * have a fresh state to save a round trip; otherwise it is fetched. When the
   * mode is unknown (e.g. the cloud reports the device offline and returns no
   * trait values) the schedule is paused anyway: pausing twice is harmless,
   * a swallowed manual command is not.
   */
  async setManual(
    cloudDeviceId: string,
    options: ManualLightOptions,
    currentMode?: string,
  ): Promise<void> {
    const mode = currentMode ?? (await this.getState(cloudDeviceId)).mode;
    if (mode === undefined || mode === "auto") await this.pauseSchedule(cloudDeviceId);

    const fields: StatePayload = {};
    if (options.status !== undefined) fields.status = options.status;
    if (options.brightnessPct !== undefined) {
      fields.brightness = { percentage: clamp(Math.round(options.brightnessPct), 0, 100) };
    }
    if (options.rgb !== undefined) {
      fields.color = {
        red: clamp(Math.round(options.rgb.red), 0, 255),
        green: clamp(Math.round(options.rgb.green), 0, 255),
        blue: clamp(Math.round(options.rgb.blue), 0, 255),
      };
    }
    if (options.white !== undefined) fields.white = { value: clamp(Math.round(options.white), 0, 255) };

    if (Object.keys(fields).length > 0) await this.setState(cloudDeviceId, fields);
  }

  /** Turn the light on, optionally with brightness / colour. Pauses the schedule if needed. */
  turnOn(cloudDeviceId: string, options: Omit<ManualLightOptions, "status"> = {}): Promise<void> {
    return this.setManual(cloudDeviceId, { ...options, status: "on" });
  }

  /** Turn the light off. Pauses the schedule if needed. */
  turnOff(cloudDeviceId: string): Promise<void> {
    return this.setManual(cloudDeviceId, { status: "off" });
  }

  /** Assign profile `slot` to a weekday (0 = Sunday .. 6 = Saturday). */
  setPresetForWeekday(cloudDeviceId: string, slot: number | string, dayOfWeek: number): Promise<unknown> {
    return this.command(cloudDeviceId, { type: "preset", action: "set", id: slot, dayOfWeek });
  }
}
