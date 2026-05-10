// 파일 내용이 비어있으므로, 기본 구조를 정의합니다.
export interface AntigravityConfig {
    endpoint: string;
    apiKey: string;
    timeoutMs: number;
}
// 이 파일은 실행 시점에 .env 파일에서 실제 값을 로드하도록 설계될 것입니다.