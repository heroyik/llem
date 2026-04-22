import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const packagePath = path.join(rootDir, 'package.json');
const lockPath = path.join(rootDir, 'package-lock.json');
const readmePath = path.join(rootDir, 'README.md');
const releaseDir = path.join(rootDir, 'release');

function parseArgs(argv) {
  const args = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--notes') {
      args.notes = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--notes=')) {
      args.notes = arg.slice('--notes='.length);
      continue;
    }

    if (arg === '--notes-file') {
      args.notesFile = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg.startsWith('--notes-file=')) {
      args.notesFile = arg.slice('--notes-file='.length);
    }
  }

  return args;
}

function usage() {
  console.error(`
VSIX 패키징에는 README에 기록할 릴리스 노트가 필요합니다.

예시:
  npm run package:vsix -- --notes "채팅을 에디터 영역으로 이동; README 릴리스 노트 자동화"
  RELEASE_NOTES=$'- 채팅을 에디터 영역으로 이동했습니다.\\n- README 릴리스 노트를 자동 기록합니다.' npm run package:vsix
  npm run package:vsix -- --notes-file release-notes.md
`);
}

function readNotes() {
  const args = parseArgs(process.argv.slice(2));
  let rawNotes = args.notes ?? process.env.RELEASE_NOTES ?? '';

  if (args.notesFile) {
    const notesFile = path.resolve(rootDir, args.notesFile);
    rawNotes = fs.readFileSync(notesFile, 'utf8');
  }

  const notes = rawNotes
    .split(/\r?\n|;/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);

  if (notes.length === 0 || notes.join(' ').length < 12) {
    usage();
    process.exit(1);
  }

  return notes;
}

function bumpPatch(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Unsupported package version: ${version}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]) + 1;
  return `${major}.${minor}.${patch}`;
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function updatePackageVersion(newVersion) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const oldVersion = pkg.version;

  pkg.version = newVersion;
  writeJson(packagePath, pkg);

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = newVersion;

  if (lock.packages?.['']) {
    lock.packages[''].version = newVersion;
  }

  writeJson(lockPath, lock);
  return oldVersion;
}

function extractPendingNotes(readme) {
  const pendingPattern = /\n### 다음 VSIX 예정\n\n([\s\S]*?)(?=\n### |\n## |$)/;
  const match = readme.match(pendingPattern);

  if (!match) {
    return { readme, notes: [] };
  }

  const notes = match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);

  return {
    readme: readme.replace(pendingPattern, '\n'),
    notes,
  };
}

function uniqueNotes(notes) {
  const seen = new Set();
  const unique = [];

  for (const note of notes) {
    if (seen.has(note)) {
      continue;
    }

    seen.add(note);
    unique.push(note);
  }

  return unique;
}

function updateReadme(oldVersion, newVersion, notes) {
  let readme = fs.readFileSync(readmePath, 'utf8');
  const pending = extractPendingNotes(readme);
  const releaseNotesBody = uniqueNotes([...pending.notes, ...notes]);

  readme = pending.readme;

  const releaseNotes = [
    `### v${newVersion}`,
    '',
    `- VSIX 빌드 버전을 \`${oldVersion}\`에서 \`${newVersion}\`로 올렸습니다.`,
    ...releaseNotesBody.map((note) => `- ${note}`),
    `- 릴리스 스크립트가 \`release/connect-ai-lab-${newVersion}.vsix\` 패키지를 생성합니다.`,
    '',
  ].join('\n');

  readme = readme
    .replace(/badge\/version-\d+\.\d+\.\d+-blue/, `badge/version-${newVersion}-blue`)
    .replace(/Connect AI v\d+\.\d+\.\d+는/, `Connect AI v${newVersion}는`)
    .replace(/최신 `connect-ai-lab-\d+\.\d+\.\d+\.vsix` 파일/, `최신 \`connect-ai-lab-${newVersion}.vsix\` 파일`);

  const heading = '## 📝 Release Notes';
  const headingIndex = readme.indexOf(heading);

  if (headingIndex === -1) {
    readme = `${readme.trimEnd()}\n\n${heading}\n\n${releaseNotes}`;
  } else {
    const insertAt = headingIndex + heading.length;
    const rest = readme.slice(insertAt).replace(/^\s*/, '');
    readme = `${readme.slice(0, insertAt)}\n\n${releaseNotes}\n${rest}`;
  }

  fs.writeFileSync(readmePath, readme);
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

const notes = readNotes();
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const oldVersion = pkg.version;
const newVersion = bumpPatch(oldVersion);

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'compile']);

updatePackageVersion(newVersion);
updateReadme(oldVersion, newVersion, notes);
fs.mkdirSync(releaseDir, { recursive: true });

const vsceBin = path.join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vsce.cmd' : 'vsce',
);
const outputPath = path.join(releaseDir, `connect-ai-lab-${newVersion}.vsix`);

run(vsceBin, ['package', '--out', outputPath]);
console.log(`Packaged ${path.relative(rootDir, outputPath)}`);
