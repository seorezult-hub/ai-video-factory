export type ModelStatus = "OK" | "COOLDOWN" | "DOWN";

export type ModelName =
  | "atlas-seedance-2"
  | "fal-seedance-15"
  | "fal-kling-pro"
  | "fal-kling"
  | "fal-hailuo"
  | "fal-wan"
  | "groq"
  | "openrouter"
  | "gemini";

export type QualityTier = "high" | "medium" | "low";

export interface ModelState {
  status: ModelStatus;
  consecutiveErrors: number;
  cooldownUntil: number | null;
  lastError: string | null;
  totalRequests: number;
  totalErrors: number;
}

const QUALITY_TIERS: Record<QualityTier, ModelName[]> = {
  high: ["atlas-seedance-2", "fal-seedance-15", "fal-kling-pro"],
  medium: ["fal-kling-pro", "fal-kling", "fal-hailuo"],
  low: ["fal-wan", "fal-kling", "fal-hailuo", "fal-seedance-15", "atlas-seedance-2"],
};

const COOLDOWN_CONSECUTIVE_MS = 5 * 60 * 1000;
const COOLDOWN_NSFW_MS = 30 * 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 2;

function makeDefaultState(): ModelState {
  return {
    status: "OK",
    consecutiveErrors: 0,
    cooldownUntil: null,
    lastError: null,
    totalRequests: 0,
    totalErrors: 0,
  };
}

class ModelRegistryClass {
  private states: Map<ModelName, ModelState> = new Map();

  private getState(model: ModelName): ModelState {
    if (!this.states.has(model)) {
      this.states.set(model, makeDefaultState());
    }
    return this.states.get(model) as ModelState;
  }

  private refreshStatus(model: ModelName): void {
    const state = this.getState(model);
    if (state.status === "COOLDOWN" && state.cooldownUntil !== null) {
      if (Date.now() >= state.cooldownUntil) {
        state.status = "OK";
        state.cooldownUntil = null;
        state.consecutiveErrors = 0;
      }
    }
  }

  isAvailable(model: ModelName): boolean {
    this.refreshStatus(model);
    const state = this.getState(model);
    return state.status === "OK";
  }

  getAvailableModel(quality: QualityTier): ModelName | null {
    const candidates = QUALITY_TIERS[quality];
    for (const model of candidates) {
      if (this.isAvailable(model)) {
        return model;
      }
    }
    return null;
  }

  recordSuccess(model: ModelName): void {
    const state = this.getState(model);
    state.consecutiveErrors = 0;
    state.status = "OK";
    state.cooldownUntil = null;
    state.totalRequests += 1;
  }

  recordError(model: ModelName, error: string, isNSFW = false): void {
    const state = this.getState(model);
    state.totalRequests += 1;
    state.totalErrors += 1;
    state.lastError = error;
    state.consecutiveErrors += 1;

    if (isNSFW) {
      state.status = "COOLDOWN";
      state.cooldownUntil = Date.now() + COOLDOWN_NSFW_MS;
      return;
    }

    if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      state.status = "COOLDOWN";
      state.cooldownUntil = Date.now() + COOLDOWN_CONSECUTIVE_MS;
    }
  }

  recordRateLimit(model: ModelName, retryAfterSeconds: number): void {
    const state = this.getState(model);
    state.status = "COOLDOWN";
    state.cooldownUntil = Date.now() + retryAfterSeconds * 1000;
    state.lastError = `Rate limited for ${retryAfterSeconds}s`;
  }

  getStatus(): Record<ModelName, ModelState> {
    const allModels: ModelName[] = [
      "atlas-seedance-2",
      "fal-seedance-15",
      "fal-kling-pro",
      "fal-kling",
      "fal-hailuo",
      "fal-wan",
      "groq",
      "openrouter",
      "gemini",
    ];

    const result = {} as Record<ModelName, ModelState>;
    for (const model of allModels) {
      this.refreshStatus(model);
      result[model] = { ...this.getState(model) };
    }
    return result;
  }

  reset(model: ModelName): void {
    this.states.set(model, makeDefaultState());
  }

  resetAll(): void {
    this.states.clear();
  }
}

const globalKey = "__model_registry__";
const globalAny = globalThis as Record<string, unknown>;

if (!globalAny[globalKey]) {
  globalAny[globalKey] = new ModelRegistryClass();
}

export const registry = globalAny[globalKey] as ModelRegistryClass;
