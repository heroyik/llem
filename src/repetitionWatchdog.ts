/**
 * RepetitionWatchdog detects infinite loops in AI-generated text.
 * It looks for repeating token sequences and character-level suffix patterns.
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

    getAbortedReason(): string | undefined {
        return this.abortedReason;
    }
}
