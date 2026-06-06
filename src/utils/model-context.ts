interface ModelContextConfig {
    maxTokens: number;
    usableTokens: number;
}

interface ModelIdentifier {
    id?: string;
    display_name?: string;
}

const DEFAULT_CONTEXT_WINDOW_SIZE = 200000;
const USABLE_CONTEXT_RATIO = 0.8;

function toValidWindowSize(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null;
    }

    return value;
}

function parseContextWindowSize(modelIdentifier: string): number | null {
    const delimitedMatch = /(?:\(|\[)\s*(\d+(?:[,_]\d+)*(?:\.\d+)?)\s*([km])\s*(?:\)|\])/i.exec(modelIdentifier);
    if (delimitedMatch) {
        const delimitedValue = delimitedMatch[1];
        const delimitedUnit = delimitedMatch[2];
        if (!delimitedValue || !delimitedUnit) {
            return null;
        }

        const parsed = Number.parseFloat(delimitedValue.replace(/[,_]/g, ''));
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.round(parsed * (delimitedUnit.toLowerCase() === 'm' ? 1000000 : 1000));
        }
    }

    const contextMatch = /\b(\d+(?:[,_]\d+)*(?:\.\d+)?)\s*([km])(?:\s*(?:token\s*)?context)?\b/i.exec(modelIdentifier);
    if (!contextMatch) {
        return null;
    }

    const contextValue = contextMatch[1];
    const contextUnit = contextMatch[2];
    if (!contextValue || !contextUnit) {
        return null;
    }

    const parsed = Number.parseFloat(contextValue.replace(/[,_]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }

    return Math.round(parsed * (contextUnit.toLowerCase() === 'm' ? 1000000 : 1000));
}

export function getModelContextIdentifier(model?: string | ModelIdentifier): string | undefined {
    if (typeof model === 'string') {
        const trimmed = model.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }

    if (!model) {
        return undefined;
    }

    const id = model.id?.trim();
    const displayName = model.display_name?.trim();

    if (id && displayName) {
        return `${id} ${displayName}`;
    }

    return id ?? displayName;
}

// Built-in context windows for well-known non-Anthropic models that reach Claude
// Code through a relay (e.g. MochiAPI). Their model IDs carry no size hint, so
// without this table they all fall back to the 200k default and the context %
// denominator is wrong. First match wins; keep specific patterns before generic
// ones. StatusJSON context_window_size and an explicit size in the model ID both
// take priority over this table. Values are each vendor's documented native
// window — edit here when they change.
const KNOWN_MODEL_CONTEXT_WINDOWS: { pattern: string; windowSize: number }[] = [
    { pattern: 'glm-4.6', windowSize: 200000 },
    { pattern: 'glm-4.5', windowSize: 128000 },
    { pattern: 'glm-4', windowSize: 128000 },
    { pattern: 'kimi-k2', windowSize: 256000 },
    { pattern: 'qwen3-coder', windowSize: 256000 },
    { pattern: 'deepseek', windowSize: 128000 }
];

function lookupKnownModelWindow(modelIdentifier: string): number | null {
    const id = modelIdentifier.toLowerCase();
    for (const { pattern, windowSize } of KNOWN_MODEL_CONTEXT_WINDOWS) {
        if (id.includes(pattern)) {
            return windowSize;
        }
    }

    return null;
}

export function getContextConfig(modelIdentifier?: string, contextWindowSize?: number | null): ModelContextConfig {
    const statusWindowSize = toValidWindowSize(contextWindowSize);
    if (statusWindowSize !== null) {
        return {
            maxTokens: statusWindowSize,
            usableTokens: Math.floor(statusWindowSize * USABLE_CONTEXT_RATIO)
        };
    }

    // Default to 200k for older models
    const defaultConfig = {
        maxTokens: DEFAULT_CONTEXT_WINDOW_SIZE,
        usableTokens: Math.floor(DEFAULT_CONTEXT_WINDOW_SIZE * USABLE_CONTEXT_RATIO)
    };

    if (!modelIdentifier) {
        return defaultConfig;
    }

    const inferredWindowSize = parseContextWindowSize(modelIdentifier);
    if (inferredWindowSize !== null) {
        return {
            maxTokens: inferredWindowSize,
            usableTokens: Math.floor(inferredWindowSize * USABLE_CONTEXT_RATIO)
        };
    }

    const knownWindowSize = lookupKnownModelWindow(modelIdentifier);
    if (knownWindowSize !== null) {
        return {
            maxTokens: knownWindowSize,
            usableTokens: Math.floor(knownWindowSize * USABLE_CONTEXT_RATIO)
        };
    }

    return defaultConfig;
}
