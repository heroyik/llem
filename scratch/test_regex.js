const regex = /<(?:read_file|read)\s+[^>]*\s*\/?>(?:<\/(?:read_file|read)>)?/gi;
const text = '이 프로젝트의 전체적인 구조와 목적을 파악하기 위해, 먼저 프로젝트의 핵심 설정 파일인 `package.json`과 주요 소스 코드의 타입을 정의하는 `src/types.ts`를 살펴보겠습니다.\n\n<read_file path="package.json"/>\n<read_file path="src/types.ts"/>\n\n---';
console.log('Original:', text);
console.log('Stripped:', text.replace(regex, ''));
