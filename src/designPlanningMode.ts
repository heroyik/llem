export type RequestExecutionPhase = 'initial' | 'followup';

const IMPLEMENTATION_HINTS = [
    'implement',
    'build',
    'create',
    'code',
    'apply',
    'reflect',
    'fix',
    'change',
    'update',
    'edit',
    'refactor',
    'rewrite',
    'add',
    'modify',
    'next.js',
    'nextjs',
    'typescript',
    'tsx',
    'ui',
    'frontend',
    '반영',
    '구현',
    '만들',
    '코딩',
    '수정',
    '고쳐',
    '리팩토링',
    '추가',
    '변경',
    '작성',
    '적용'
];

const NON_IMPLEMENTATION_HINTS = [
    'summarize',
    'summary',
    'explain',
    'what is',
    'why',
    'review',
    'analyze',
    'translate',
    '요약',
    '설명',
    '리뷰',
    '분석',
    '번역'
];

function normalize(value: string): string {
    return String(value || '').trim().toLowerCase();
}

export function shouldUseDesignPlanningMode(prompt: string, attachmentNames: string[] = []): boolean {
    const normalizedPrompt = normalize(prompt);
    const normalizedAttachments = attachmentNames.map(normalize).join(' ');
    const combinedText = `${normalizedPrompt} ${normalizedAttachments}`.trim();

    if (!combinedText) {
        return false;
    }

    const hasImplementationIntent = IMPLEMENTATION_HINTS.some(hint => combinedText.includes(hint));
    if (!hasImplementationIntent) {
        return false;
    }

    const hasNonImplementationIntent = NON_IMPLEMENTATION_HINTS.some(hint => normalizedPrompt.includes(hint));
    if (hasNonImplementationIntent && !hasExplicitCodeTarget(combinedText)) {
        return false;
    }

    return true;
}

export function buildDesignPlanningDirective(phase: RequestExecutionPhase): string {
    if (phase === 'initial') {
        return `\n\n[IMPLEMENTATION PLANNING MODE]\nThe user is asking for implementation work.\nFor this first response, DO NOT emit file actions yet. First provide only:\n1. a compact implementation summary,\n2. a small file split plan,\n3. the next 1 to 2 files you would implement first.\nDo not generate a giant single-file solution. Do not create, edit, delete, or run anything in this first response.`;
    }

    return `\n\n[IMPLEMENTATION PLANNING MODE]\nContinue implementation in small steps. Limit yourself to a small number of file actions, prefer small files, and avoid repeating structures already created earlier.`;
}

function hasExplicitCodeTarget(text: string): boolean {
    return [
        '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.py', '.java', '.go', '.rs',
        'component', 'page', 'screen', 'api', 'route', 'function', 'class', 'hook',
        '파일', '컴포넌트', '페이지'
    ].some(hint => text.includes(hint));
}
