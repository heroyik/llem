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
      continue;
    }

    if (arg === '--local') {
      args.local = true;
      continue;
    }

    if (arg === '--public') {
      args.local = false;
      continue;
    }
  }

  return args;
}

function usage() {
  console.error(`
VSIX packaging needs release notes so README updates stay honest.

Examples:
  npm run package:vsix -- --notes "Refreshed the LLeM branding; rewired the vault flow"
  RELEASE_NOTES=$'- Refreshed the LLeM branding.\\n- Rewired the vault flow.' npm run package:vsix
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

function isLocalBuild() {
  const args = parseArgs(process.argv.slice(2));
  const envValue = process.env.LOCAL_VSIX;

  if (typeof args.local === 'boolean') {
    return args.local;
  }

  return envValue === '1' || envValue === 'true';
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

function makeLocalPublisher(publisher) {
  return publisher;
}

function makeLocalDisplayName(displayName) {
  return displayName;
}

function getArtifactBaseName() {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return pkg.name || 'extension';
}

function updatePackageVersion(newVersion, options = {}) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const oldVersion = pkg.version;
  const originalPublisher = pkg.publisher;
  const originalDisplayName = pkg.displayName;

  pkg.version = newVersion;
  if (options.local) {
    pkg.publisher = makeLocalPublisher(pkg.publisher);
    pkg.displayName = makeLocalDisplayName(pkg.displayName);
  }
  writeJson(packagePath, pkg);

  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = newVersion;

  if (lock.packages?.['']) {
    lock.packages[''].version = newVersion;
  }

  writeJson(lockPath, lock);
  return {
    oldVersion,
    originalDisplayName,
    originalPublisher,
  };
}

function restorePackageIdentity(newVersion, snapshot) {
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  pkg.version = newVersion;
  pkg.publisher = snapshot.originalPublisher;
  pkg.displayName = snapshot.originalDisplayName;
  writeJson(packagePath, pkg);
}

function extractPendingNotes(readme) {
  const pendingPattern = /\n### Next VSIX\n\n([\s\S]*?)(?=\n### |\n## |$)/;
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

function stripReadmeLogoImages(readme) {
  return readme
    .replace(
      /\n*<p\s+align="center">\s*<img\b[^>]*(?:alt="LLeM logo"|assets\/icon\.png)[^>]*\/?>\s*<\/p>\s*/gi,
      '\n',
    )
    .replace(/<img\b[^>]*(?:alt="LLeM logo"|assets\/icon\.png)[^>]*\/?>\s*/gi, '');
}

function updateReadme(oldVersion, newVersion, notes) {
  let readme = fs.readFileSync(readmePath, 'utf8');
  const pending = extractPendingNotes(readme);
  const releaseNotesBody = uniqueNotes([...pending.notes, ...notes]);
  const artifactBaseName = getArtifactBaseName();

  readme = stripReadmeLogoImages(pending.readme);

  const releaseNotes = [
    `### v${newVersion}`,
    '',
    `- Bumped the VSIX build from \`${oldVersion}\` to \`${newVersion}\`.`,
    ...releaseNotesBody.map((note) => `- ${note}`),
    `- Packaged \`release/${artifactBaseName}-${newVersion}.vsix\`.`,
    '',
  ].join('\n');

  const heading = '## Release Notes';
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
    shell: process.platform === 'win32',
  });
}

const notes = readNotes();
const localBuild = isLocalBuild();
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const oldVersion = pkg.version;
const newVersion = bumpPatch(oldVersion);
const artifactBaseName = pkg.name || 'extension';

run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'compile']);

const identitySnapshot = updatePackageVersion(newVersion, { local: localBuild });
updateReadme(oldVersion, newVersion, notes);
fs.mkdirSync(releaseDir, { recursive: true });

const vsceBin = path.join(
  rootDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vsce.cmd' : 'vsce',
);
const outputPath = path.join(releaseDir, `${artifactBaseName}-${newVersion}.vsix`);

try {
  run(vsceBin, ['package', '--out', outputPath]);
  console.log(`Packaged ${path.relative(rootDir, outputPath)}`);
} finally {
  if (localBuild) {
    restorePackageIdentity(newVersion, identitySnapshot);
  }
}
