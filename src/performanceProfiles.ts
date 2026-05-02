import { getSystemSpecs } from './hardwareDetection';
import type {
    InstalledModelInfo,
    ModelContextBudget,
    ModelProfile,
    ModelRequestTuning,
    PerformancePreset,
    ResolvedPerformancePreset
} from './types';

const BALANCED_REQUEST_TUNING: ModelRequestTuning = {
    numCtx: 32_768,
    initialPredict: -1,
    followupPredict: -1,
    repeatPenalty: 1.15
};

const LARGE_LOCAL_26B_REQUEST_TUNING: ModelRequestTuning = {
    numCtx: 32_768,
    initialPredict: -1,
    followupPredict: -1,
    repeatPenalty: 1.15
};

const LARGE_LOCAL_26B_CONTEXT_BUDGET: ModelContextBudget = {
    totalPromptChars: 28_000,
    activeEditorChars: 6_000,
    workspaceChars: 4_000,
    vaultChars: 4_000,
    attachmentFileChars: 8_000,
    attachmentTotalChars: 16_000
};

export function parseParameterSizeBillions(value?: string): number | undefined {
    if (!value) {
        return undefined;
    }

    const match = String(value).match(/(\d+(?:\.\d+)?)\s*B/i);
    if (!match) {
        return undefined;
    }

    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseModelNameBillions(modelName: string): number | undefined {
    const match = String(modelName || '').match(/(?:^|[^0-9])(\d+(?:\.\d+)?)b(?:[^a-z0-9]|$)/i);
    if (!match) {
        return undefined;
    }

    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
}

export function isLargeLocal26BModel(modelName: string, parameterSize?: string): boolean {
    const sizeFromMetadata = parseParameterSizeBillions(parameterSize);
    if (typeof sizeFromMetadata === 'number' && sizeFromMetadata >= 24) {
        return true;
    }

    const sizeFromName = parseModelNameBillions(modelName);
    return typeof sizeFromName === 'number' && sizeFromName >= 24;
}

export function resolvePerformancePreset(
    requestedPreset: PerformancePreset,
    modelName: string,
    parameterSize?: string
): ResolvedPerformancePreset {
    if (requestedPreset === 'balanced' || requestedPreset === 'large-local-26b') {
        return requestedPreset;
    }

    return isLargeLocal26BModel(modelName, parameterSize) ? 'large-local-26b' : 'balanced';
}

export function buildModelProfile(input: {
    modelName: string;
    requestedPreset: PerformancePreset;
    parameterSize?: string;
    family?: string;
}): ModelProfile {
    const specs = getSystemSpecs();
    const estimatedParameterSizeB = parseParameterSizeBillions(input.parameterSize) ?? parseModelNameBillions(input.modelName);
    const resolvedPreset = resolvePerformancePreset(input.requestedPreset, input.modelName, input.parameterSize);

    let tuning = resolvedPreset === 'large-local-26b'
        ? { ...LARGE_LOCAL_26B_REQUEST_TUNING }
        : { ...BALANCED_REQUEST_TUNING };

    // Hardware-aware dynamic tuning
    if (resolvedPreset === 'large-local-26b') {
        // High repeat penalty for Gemma 2 (often the 26B choice)
        tuning.repeatPenalty = 1.25;

        if (specs.isLowEnd) {
            tuning.numCtx = 4096; // Aggressive limit for low RAM
        } else if (specs.isMidRange) {
            tuning.numCtx = 8192; // Default for mid-range
        } else if (specs.isHighEnd) {
            tuning.numCtx = 16384; // Safe upper bound for 32GB+
        }
        
        // Boost context further if it's Apple Silicon with high RAM
        if (specs.isAppleSilicon && specs.totalRamGb >= 32) {
            tuning.numCtx = 32768;
        }
    } else {
        // Balanced tuning
        if (specs.isLowEnd) {
            tuning.numCtx = 8192;
        }
    }

    const contextBudget: ModelContextBudget | undefined = resolvedPreset === 'large-local-26b'
        ? {
            ...LARGE_LOCAL_26B_CONTEXT_BUDGET,
            totalPromptChars: Math.floor(tuning.numCtx * 0.85) // Dynamic budget based on numCtx
        }
        : undefined;

    return {
        modelName: input.modelName,
        requestedPreset: input.requestedPreset,
        resolvedPreset,
        estimatedParameterSizeB,
        family: input.family,
        requestTuning: tuning,
        contextBudget,
        warningTimeoutMs: resolvedPreset === 'large-local-26b' ? 600_000 : undefined
    };
}

export function findInstalledModelInfo(modelName: string, catalog: InstalledModelInfo[]): InstalledModelInfo | undefined {
    return catalog.find(entry => entry.name === modelName);
}
