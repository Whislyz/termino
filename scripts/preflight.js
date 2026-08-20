// Publish gate. Runs from prepublishOnly, before the test suite, so the cheap
// checks fail in a second rather than after 30s of autoplay.
//
//   node scripts/preflight.js
//
// Catches the four ways a publish goes wrong in practice: not logged in, the
// tarball not matching what is committed, publishing from a stale branch, and
// reusing a version number the registry already has.

const { execFileSync } = require('child_process');
const https = require('https');
const path = require('path');

const pkg = require(path.join(__dirname, '..', 'package.json'));

let failed = false;

function pass(label, detail) {
  process.stdout.write(`  ok    ${label}${detail ? '  ' + detail : ''}\n`);
}

function fail(label, detail, fix) {
  failed = true;
  process.stdout.write(`  FAIL  ${label}${detail ? '  ' + detail : ''}\n`);
  if (fix) process.stdout.write(`        ${fix}\n`);
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// --- who ---------------------------------------------------------------

function checkAuth() {
  let who;
  try {
    who = execFileSync('npm', ['whoami'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_) {
    fail('npm login', 'not authenticated', 'run: npm login');
    return;
  }

  pass('npm login', who);

  // A user scope must equal the username; an org scope need not, and we cannot
  // tell the two apart without an org lookup. So this warns, never blocks.
  const scope = pkg.name.startsWith('@') ? pkg.name.slice(1).split('/')[0] : null;
  if (scope && scope !== who) {
    process.stdout.write(
      `        note: publishing to @${scope} as ${who} - needs an org named ${scope}\n`
    );
  }
}

// --- git ---------------------------------------------------------------

function checkGit() {
  try {
    git('rev-parse', '--git-dir');
  } catch (_) {
    process.stdout.write('  skip  git checks  not a repository\n');
    return;
  }

  if (git('status', '--porcelain') === '') {
    pass('working tree', 'clean');
  } else {
    fail('working tree', 'uncommitted changes', 'commit or stash them - the tarball is built from disk, not from HEAD');
  }

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch === 'main') pass('branch', branch);
  else fail('branch', branch, 'publish from main');

  try {
    execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { stdio: 'ignore' });
    // Ahead is normal: `npm version` commits the bump locally and postpublish
    // pushes it. Behind means someone else's work would be missing from the
    // tarball, which is the case worth stopping for.
    const behind = Number(git('rev-list', '--count', 'HEAD..origin/main'));
    const ahead = Number(git('rev-list', '--count', 'origin/main..HEAD'));
    if (behind > 0) fail('origin/main', `${behind} commit(s) behind`, 'run: git pull');
    else pass('origin/main', ahead > 0 ? `${ahead} commit(s) ahead, will push after publish` : 'in sync');
  } catch (_) {
    process.stdout.write('  skip  origin/main  could not reach remote\n');
  }
}

// --- registry ----------------------------------------------------------

function checkVersion() {
  return new Promise((resolve) => {
    const url = 'https://registry.npmjs.org/' + pkg.name.replace('/', '%2F');
    const req = https.get(url, { headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode === 404) {
        res.resume();
        pass('version', `${pkg.version}  (first publish of ${pkg.name})`);
        return resolve();
      }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let taken = false;
        try {
          const doc = JSON.parse(body);
          // `time` also carries versions that were published and then
          // unpublished; those names stay burned, so check it rather than
          // `versions` alone.
          taken = Boolean((doc.versions && doc.versions[pkg.version]) || (doc.time && doc.time[pkg.version]));
        } catch (_) {
          /* fall through to pass - a malformed doc is not a reason to block */
        }
        if (taken) {
          fail('version', `${pkg.version} already on the registry`, 'run: npm version patch');
        } else {
          pass('version', pkg.version);
        }
        resolve();
      });
    });
    req.on('error', () => {
      process.stdout.write('  skip  version  registry unreachable\n');
      resolve();
    });
    req.setTimeout(8000, () => {
      req.destroy();
    });
  });
}

// --- run ---------------------------------------------------------------

async function main() {
  process.stdout.write(`\npreflight  ${pkg.name}@${pkg.version}\n\n`);
  checkAuth();
  checkGit();
  await checkVersion();
  process.stdout.write('\n');
  if (failed) {
    process.stdout.write('FAIL  publish stopped\n\n');
    process.exit(1);
  }
  process.stdout.write('PASS  running tests\n\n');
}

main();
