export interface RecentBlockLoopOptions {
    blockSize?: number;
    minSignificantChars?: number;
    threshold?: number;
}

export interface ImportantSentenceLoopOptions {
    minSentenceLength?: number;
    minSignificantChars?: number;
    threshold?: number;
}

const DEFAULT_RECENT_BLOCK_SIZE = 100;
const DEFAULT_MIN_SIGNIFICANT_CHARS = 30;
const DEFAULT_RECENT_BLOCK_THRESHOLD = 3;
const DEFAULT_MIN_SENTENCE_LENGTH = 40;
const DEFAULT_IMPORTANT_SENTENCE_THRESHOLD = 3;

/**
 * RepetitionWatchdog detects infinite loops in AI-generated text.
 * It looks for repeating token sequences, character-level suffix patterns,
 * and repeated recent text blocks across the generated output.
 */
export class RepetitionWatchdog {
    private tokens: string[] = [];
    private fullText: string = '';
    private abortedReason: string | undefined;

    constructor(
        private maxHistory = 150,
        private minTextMatch = 30, // Min characters to consider a suffix repeat a loop
        private minTokenSequence = 4 // Min tokens to consider a sequence repeat a loop
    ) {}

    /**
     * Adds a token and checks for loops.
     * @returns true if a loop is detected.
     */
    addToken(token: string): boolean {
        if (!token) return false;
        
        this.tokens.push(token);
        this.fullText += token;

        if (this.tokens.length > this.maxHistory) {
            this.tokens.shift();
        }
        
        // Keep fullText window manageable
        if (this.fullText.length > 2000) {
            this.fullText = this.fullText.slice(-2000);
        }

        // 1. Single Token Spam (e.g. "........")
        if (token.length > 1) {
            const lastN = this.tokens.slice(-10);
            const occurrences = lastN.filter(t => t === token).length;
            if (occurrences >= 8 && !isLowSignalMarkdownStructureToken(token)) {
                this.abortedReason = `token spam: "${token}"`;
                return true;
            }
        }

        // 2. Token Sequence Loop (e.g. "<run>ls</run><run>ls</run>")
        if (this.detectTokenSequenceLoop()) {
            return true;
        }

        // 2.5. Complete action block loop (same edit/create action emitted repeatedly)
        if (this.detectRepeatedActionBlockLoop()) {
            return true;
        }

        // 3. Character Suffix Loop (e.g. long sentences repeating)
        if (this.detectSuffixLoop()) {
            return true;
        }

        // 4. Recent Block Loop (e.g. the same paragraph keeps resurfacing)
        if (this.detectRecentBlockLoop()) {
            return true;
        }

        // 5. Important Sentence Loop (e.g. the same key statement keeps repeating)
        if (this.detectImportantSentenceLoop()) {
            return true;
        }

        return false;
    }

    private detectTokenSequenceLoop(): boolean {
        const n = this.tokens.length;
        if (n < this.minTokenSequence * 3) return false;

        // Check for repeating sequences of length L.
        // Require three consecutive copies to avoid false positives while generating code,
        // markdown tables, or action-tag fragments.
        for (let l = this.minTokenSequence; l <= Math.floor(n / 3); l++) {
            const currentTokens = this.tokens.slice(-l).map(t => t.trim());
            const previousTokens = this.tokens.slice(-2 * l, -l).map(t => t.trim());
            const olderTokens = this.tokens.slice(-3 * l, -2 * l).map(t => t.trim());

            if (isLowSignalMarkdownStructureSequence(currentTokens) && isLowSignalMarkdownStructureSequence(previousTokens)) {
                continue;
            }
            if (
                isStructuredCodeOrActionSequence(currentTokens)
                && isStructuredCodeOrActionSequence(previousTokens)
                && isStructuredCodeOrActionSequence(olderTokens)
            ) {
                continue;
            }
            if (
                isLowSignalStructuredFragmentSequence(currentTokens)
                && isLowSignalStructuredFragmentSequence(previousTokens)
                && isLowSignalStructuredFragmentSequence(olderTokens)
            ) {
                continue;
            }

            const current = currentTokens.join('\u0000');
            const previous = previousTokens.join('\u0000');
            const older = olderTokens.join('\u0000');
            if (current === previous && previous === older && current.length > 10) {
                this.abortedReason = `sequence loop (len=${l})`;
                return true;
            }
        }
        return false;
    }

    private detectRepeatedActionBlockLoop(): boolean {
        const repeated = findRepeatedCompletedActionBlock(this.fullText, 3);
        if (repeated.detected) {
            this.abortedReason = `repeated action block loop (kind=${repeated.kind}, count=${repeated.count})`;
            return true;
        }
        return false;
    }

    private isRepeatedActionTagToken(curr: string, prev: string): boolean {
        const patterns = /^<\/?(?:edit_file|find|replace|create_file)\b|^<\/edit_file>|^<\/create_file>|>\s*$/;
        return patterns.test(curr.trim()) && patterns.test(prev.trim());
    }

    private detectSuffixLoop(): boolean {
        const text = this.fullText;
        const len = text.length;
        if (len < this.minTextMatch * 2) return false;

        // 🔧 추가: 현재 스트림이 구조화된 코드/액션이면 suffix 루프 무시
        if (isStructuredCodeOrActionText(text.slice(-500))) {
            return false;
        }

        // Heuristic: check last 500 chars for a repeating suffix
        const checkWindow = Math.min(500, len);
        const sub = text.slice(-checkWindow);
        const subLen = sub.length;

        for (let l = this.minTextMatch; l <= Math.floor(subLen / 2); l++) {
            const suffix = sub.slice(-l);
            const prev = sub.slice(-2 * l, -l);
            if (isLowSignalMarkdownStructureText(suffix) && isLowSignalMarkdownStructureText(prev)) {
                continue;
            }
            // 🔧 추가: 액션 태그 토큰 반복 예외
            if (this.isRepeatedActionTagToken(suffix, prev)) {
                continue;
            }
            if (suffix === prev) {
                this.abortedReason = `text suffix loop (len=${l})`;
                return true;
            }
        }
        return false;
    }

    private detectRecentBlockLoop(): boolean {
        const result = detectRecentBlockLoop(this.fullText);
        
        // 🔧 추가: 결과는 반환하되, 액션 태그 밀집도가 높으면 false로 오버라이드
        if (result.detected) {
            const recentText = this.fullText.slice(-500);
            const actionTagDensity = (recentText.match(/<\/?(?:edit_file|create_file|find|replace)\b/gi) || []).length;
            
            // 액션 태그가 충분히 많으면 false positive로 판단
            if (actionTagDensity >= 5 && result.blockSize <= 150) {
                return false;
            }
            
            this.abortedReason = `recent block loop (len=${result.blockSize}, count=${result.count})`;
            return true;
        }
        return false;
    }

    private detectImportantSentenceLoop(): boolean {
        const result = detectImportantSentenceLoop(this.fullText);
        if (result.detected) {
            this.abortedReason = `important sentence loop (count=${result.count})`;
            return true;
        }
        return false;
    }

    getAbortedReason(): string | undefined {
        return this.abortedReason;
    }
}

export function detectRecentBlockLoop(
    text: string,
    options: RecentBlockLoopOptions = {}
): { detected: boolean; count: number; blockSize: number } {
    const blockSize = options.blockSize ?? DEFAULT_RECENT_BLOCK_SIZE;
    const minSignificantChars = options.minSignificantChars ?? DEFAULT_MIN_SIGNIFICANT_CHARS;
    const threshold = options.threshold ?? DEFAULT_RECENT_BLOCK_THRESHOLD;

    if (text.length < blockSize * threshold) {
        return { detected: false, count: 0, blockSize };
    }

    const currentBlock = text.slice(-blockSize);
    if (isStructuredCodeOrActionText(currentBlock)) {
        return { detected: false, count: 0, blockSize };
    }

    const significantChars = currentBlock.match(/[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g);
    if (!significantChars || significantChars.length < minSignificantChars) {
        return { detected: false, count: 0, blockSize };
    }
    const uniqueChars = new Set(significantChars.map(char => char.toLowerCase()));
    if (uniqueChars.size < 5) {
        return { detected: false, count: 0, blockSize };
    }

    let count = 0;
    let index = text.indexOf(currentBlock);

    while (index !== -1) {
        count++;
        if (count >= threshold) {
            return { detected: true, count, blockSize };
        }
        index = text.indexOf(currentBlock, index + blockSize);
    }

    return { detected: false, count, blockSize };
}

function findRepeatedCompletedActionBlock(
    text: string,
    threshold: number
): { detected: boolean; count: number; kind?: string } {
    const counts = new Map<string, { count: number; kind: string }>();
    const actionBlockRegex = /<(edit_file|create_file)\b[^>]*>[\s\S]*?<\/\1>/gi;
    let match: RegExpExecArray | null;

    while ((match = actionBlockRegex.exec(text)) !== null) {
        const rawBlock = match[0];
        const kind = match[1].toLowerCase();
        const normalizedBlock = rawBlock
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();

        if (normalizedBlock.length < 40) {
            continue;
        }

        const current = counts.get(normalizedBlock) ?? { count: 0, kind };
        current.count += 1;
        counts.set(normalizedBlock, current);

        if (current.count >= threshold) {
            return { detected: true, count: current.count, kind: current.kind };
        }
    }

    return { detected: false, count: 0 };
}

export function detectImportantSentenceLoop(
    text: string,
    options: ImportantSentenceLoopOptions = {}
): { detected: boolean; count: number; sentence: string } {
    const minSentenceLength = options.minSentenceLength ?? DEFAULT_MIN_SENTENCE_LENGTH;
    const minSignificantChars = options.minSignificantChars ?? DEFAULT_MIN_SIGNIFICANT_CHARS;
    const threshold = options.threshold ?? DEFAULT_IMPORTANT_SENTENCE_THRESHOLD;

    const sentences = splitIntoSentences(text)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence.length >= minSentenceLength);
    if (sentences.length === 0) {
        return { detected: false, count: 0, sentence: '' };
    }

    const currentSentence = sentences[sentences.length - 1];
    const normalizedCurrentSentence = normalizeSentence(currentSentence);
    if (isStructuredCodeOrActionText(currentSentence)) {
        return { detected: false, count: 0, sentence: currentSentence };
    }
    if (!isSignificantText(normalizedCurrentSentence, minSignificantChars)) {
        return { detected: false, count: 0, sentence: currentSentence };
    }

    let count = 0;
    for (const sentence of sentences) {
        if (normalizeSentence(sentence) === normalizedCurrentSentence) {
            count++;
            if (count >= threshold) {
                return { detected: true, count, sentence: currentSentence };
            }
        }
    }

    return { detected: false, count, sentence: currentSentence };
}

function splitIntoSentences(text: string): string[] {
    return text
        .split(/(?<=[.!?。！？\n])\s+/)
        .map(part => part.trim())
        .filter(Boolean);
}

function normalizeSentence(sentence: string): string {
    return sentence
        .replace(/\s+/g, ' ')
        .replace(/[“”"'`]+/g, '')
        .trim()
        .toLowerCase();
}

function isSignificantText(text: string, minSignificantChars: number): boolean {
    const significantChars = text.match(/[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/g);
    if (!significantChars || significantChars.length < minSignificantChars) {
        return false;
    }
    const uniqueChars = new Set(significantChars.map(char => char.toLowerCase()));
    return uniqueChars.size >= 5;
}

function isLowSignalMarkdownStructureSequence(tokens: string[]): boolean {
    if (tokens.length === 0) {
        return false;
    }

    let meaningfulCount = 0;
    for (const token of tokens) {
        const normalized = token.trim();
        if (!normalized) {
            continue;
        }
        meaningfulCount++;
        if (!isLowSignalMarkdownStructureToken(normalized)) {
            return false;
        }
    }

    return meaningfulCount > 0;
}

function isStructuredCodeOrActionSequence(tokens: string[]): boolean {
    const meaningfulTokens = tokens
        .map(token => token.trim())
        .filter(Boolean);

    if (meaningfulTokens.length === 0) {
        return false;
    }

    const combined = meaningfulTokens.join(' ');
    if (isStructuredCodeOrActionText(combined)) {
        return true;
    }

    let structuredCount = 0;
    for (const token of meaningfulTokens) {
        if (isCodeOrActionToken(token)) {
            structuredCount++;
        }
    }

    return structuredCount >= Math.max(2, Math.ceil(meaningfulTokens.length * 0.6));
}

function isLowSignalMarkdownStructureToken(token: string): boolean {
    const normalized = String(token || '').trim();
    if (!normalized) {
        return false;
    }

    return (
        /^`{3,}[a-z0-9_-]*$/i.test(normalized) ||
        /^~{3,}[a-z0-9_-]*$/i.test(normalized) ||
        /^#{1,6}$/.test(normalized) ||
        /^#{1,6}\s*$/.test(normalized) ||
        /^>+$/.test(normalized) ||
        /^[-*+]$/.test(normalized) ||
        /^\d+\.$/.test(normalized) ||
        /^\[[ xX]\]$/.test(normalized) ||
        /^[-*_]{3,}$/.test(normalized) ||
        /^[|:.\-]+$/.test(normalized) ||
        /^\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\|?$/.test(normalized)
    );
}

function isLowSignalMarkdownStructureText(text: string): boolean {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return false;
    }

    const stripped = normalized.replace(/[|:.\-`~#>*+\[\]\sxX0-9]/g, '');
    return stripped.length === 0;
}

function isStructuredCodeOrActionText(text: string): boolean {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return false;
    }

    if (/<\/?(?:create_file|file|edit_file|edit|delete_file|delete|read_file|read|list_files|list_dir|ls|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|find|replace)\b/i.test(normalized)) {
        return true;
    }

    // 🔧 추가: 코드 블록이 많으면 구조화된 텍스트로 간주
    const codeFenceCount = (normalized.match(/```/g) || []).length;
    if (codeFenceCount >= 2) {
        return true;
    }

    if (/^\s*(?:interface|type|export\s+(?:const|function|class|type|interface)|const|let|var|function|class|return)\b/m.test(normalized)) {
        return true;
    }

    const lineCount = normalized.split('\n').length;
    const codePunctuationCount = (normalized.match(/[{}();<>[\]=]/g) || []).length;
    const sentencePunctuationCount = (normalized.match(/[.!?。！？]/g) || []).length;
    const semicolonLineCount = normalized
        .split('\n')
        .filter(line => /[;{}]$/.test(line.trim())).length;

    if (lineCount >= 3 && codePunctuationCount >= 8 && sentencePunctuationCount <= 1) {
        return true;
    }

    if (semicolonLineCount >= 2 && codePunctuationCount >= 6) {
        return true;
    }

    return false;
}

function isCodeOrActionToken(token: string): boolean {
    const normalized = String(token || '').trim();
    if (!normalized) {
        return false;
    }

    return (
        /^<\/?(?:create_file|file|edit_file|edit|delete_file|delete|read_file|read|list_files|list_dir|ls|run_command|command|bash|terminal|read_url|url|fetch_url|read_brain|read_vault|find|replace)\b/i.test(normalized) ||
        /^<\/?(?:div|span|section|article|header|footer|main|motion)\b/i.test(normalized) ||
        /^(?:className|interface|type|export|const|let|var|function|return)$/.test(normalized) ||
        /^(?:edit|file|find|replace|create|delete|read|list|run|command|path)$/.test(normalized) ||
        /^[{}()[\];,.:=<>/_-]+$/.test(normalized)
    );
}

function isLowSignalStructuredFragmentSequence(tokens: string[]): boolean {
    const meaningfulTokens = tokens
        .map(token => token.trim())
        .filter(Boolean);

    if (meaningfulTokens.length === 0) {
        return false;
    }

    let fragmentCount = 0;
    for (const token of meaningfulTokens) {
        if (
            isLowSignalMarkdownStructureToken(token)
            || isCodeOrActionToken(token)
            || /^(?:<\/?[a-z_:-]+|[a-z_:-]+\/?>)$/i.test(token)
        ) {
            fragmentCount++;
        }
    }

    return fragmentCount >= Math.ceil(meaningfulTokens.length * 0.8);
}
