export interface RapidMlxTextSamplingSettings {
    temperature: number;
    topP: number;
    topK: number;
    repeatPenalty: number;
    maxTokens: number;
}

export interface SamplingProfile {
    profile: string;
    temperature: number;
    topP: number;
    topK: number;
    repeatPenalty: number;
    predictTokens: number;
}

export const RAPID_MLX_TEXT_SAMPLING_DEFAULTS: RapidMlxTextSamplingSettings = {
    temperature: 0.35,
    topP: 0.85,
    topK: 30,
    repeatPenalty: 1.12,
    maxTokens: 3072
};

export const RAPID_MLX_IMAGE_SAMPLING: SamplingProfile = {
    profile: 'rapid-mlx-image-safe',
    temperature: 0.2,
    topP: 0.85,
    topK: 20,
    repeatPenalty: 1.12,
    predictTokens: 2048
};

export const RAPID_MLX_TEXT_SAMPLING_PROFILE = 'rapid-mlx-text-safe';

export function normalizeRapidMlxTextSampling(value: unknown): RapidMlxTextSamplingSettings {
    const raw = value && typeof value === 'object' ? value as Partial<RapidMlxTextSamplingSettings> : {};
    return {
        temperature: numberOrDefault(raw.temperature, RAPID_MLX_TEXT_SAMPLING_DEFAULTS.temperature),
        topP: numberOrDefault(raw.topP, RAPID_MLX_TEXT_SAMPLING_DEFAULTS.topP),
        topK: Math.round(numberOrDefault(raw.topK, RAPID_MLX_TEXT_SAMPLING_DEFAULTS.topK)),
        repeatPenalty: numberOrDefault(raw.repeatPenalty, RAPID_MLX_TEXT_SAMPLING_DEFAULTS.repeatPenalty),
        maxTokens: Math.round(numberOrDefault(raw.maxTokens, RAPID_MLX_TEXT_SAMPLING_DEFAULTS.maxTokens))
    };
}

export function buildRapidMlxTextSamplingProfile(settings: RapidMlxTextSamplingSettings): SamplingProfile {
    const normalized = normalizeRapidMlxTextSampling(settings);
    return {
        profile: RAPID_MLX_TEXT_SAMPLING_PROFILE,
        temperature: normalized.temperature,
        topP: normalized.topP,
        topK: normalized.topK,
        repeatPenalty: normalized.repeatPenalty,
        predictTokens: normalized.maxTokens
    };
}

function numberOrDefault(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
