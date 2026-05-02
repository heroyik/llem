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
            if (occurrences >= 8) {
                this.abortedReason = `token spam: "${token}"`;
                return true;
            }
        }

        // 2. Token Sequence Loop (e.g. "<run>ls</run><run>ls</run>")
        if (this.detectTokenSequenceLoop()) {
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
        if (n < this.minTokenSequence * 2) return false;

        // Check for repeating sequences of length L
        for (let l = this.minTokenSequence; l <= Math.floor(n / 2); l++) {
            // Normalize tokens (trim) to catch variations in whitespace/tokenization
            const current = this.tokens.slice(-l).map(t => t.trim()).join('\u0000');
            const previous = this.tokens.slice(-2 * l, -l).map(t => t.trim()).join('\u0000');
            if (current === previous && current.length > 10) {
                this.abortedReason = `sequence loop (len=${l})`;
                return true;
            }
        }
        return false;
    }

    private detectSuffixLoop(): boolean {
        const text = this.fullText;
        const len = text.length;
        if (len < this.minTextMatch * 2) return false;

        // Heuristic: check last 500 chars for a repeating suffix
        const checkWindow = Math.min(500, len);
        const sub = text.slice(-checkWindow);
        const subLen = sub.length;

        for (let l = this.minTextMatch; l <= Math.floor(subLen / 2); l++) {
            const suffix = sub.slice(-l);
            const prev = sub.slice(-2 * l, -l);
            if (suffix === prev) {
                this.abortedReason = `text suffix loop (len=${l})`;
                return true;
            }
        }
        return false;
    }

    private detectRecentBlockLoop(): boolean {
        const result = detectRecentBlockLoop(this.fullText);
        if (result.detected) {
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
