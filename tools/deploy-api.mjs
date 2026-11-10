// One command to make the web app (/exec) run the code you just pushed:
//   clasp push --force  →  clasp create-version  →  clasp update-deployment <id> -V <n>
// The deployment ID is read from API_URLS[env] in web/js/config.js, so there is one source of truth.
//
// Usage: npm run deploy:api [-- "description"]          (dev:  .clasp.json,      clasp user "default")
//        npm run deploy:api:staging [-- "description"]  (staging: .clasp.staging.json, clasp user "cc")
//        npm run deploy:api:prod [-- "description"]     (prod: .clasp.prod.json, clasp user "cc")
//        node tools/deploy-api.mjs --env prod --create  (first time only: makes the web app deployment, prints its URL)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const ENVS = {
  dev: { project: '.clasp.json', user: 'default' },
  staging: { project: '.clasp.staging.json', user: 'cc' },  // Council workspace, test sheet + test folders
  prod: { project: '.clasp.prod.json', user: 'cc' }         // Council workspace, the real sheet. clasp -u cc login (as the Council account)
};

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 1) && true : false; };
const opt = (name) => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const env = opt('--env') || 'dev';
const create = flag('--create');
const E = ENVS[env];
if (!E) { console.error(`Unknown env "${env}". Use: ${Object.keys(ENVS).join(', ')}`); process.exit(1); }

const root = new URL('../', import.meta.url);
if (!fs.existsSync(new URL(E.project, root))) {
  console.error(`${E.project} is missing. Copy .clasp.json.example to ${E.project} and paste the ${env} Script ID.`);
  process.exit(1);
}

const desc = argv[0] || `deploy ${env} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
const clasp = (...args) => {
  const full = ['-u', E.user, '-P', E.project, ...args];
  console.log('$ clasp ' + full.join(' '));
  const out = execFileSync('clasp', full, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
  process.stdout.write(out);
  return out;
};

// Show who we are about to deploy as; a wrong account here is the mistake this script exists to prevent.
clasp('show-authorized-user');

const cfg = fs.readFileSync(new URL('web/js/config.js', root), 'utf8');
const id = (new RegExp(`\\b${env}:\\s*'https://script\\.google\\.com/macros/s/([A-Za-z0-9_-]+)/exec'`).exec(cfg) || [])[1];

if (create) {
  if (id) { console.error(`${env} already has a deployment in web/js/config.js (${id}); refusing to create another.`); process.exit(1); }
  clasp('push', '--force');
  const out = clasp('create-deployment', '-d', desc);
  const newId = (/(AKfy[A-Za-z0-9_-]+)/.exec(out) || [])[1];
  if (!newId) { console.error('Could not read the deployment ID from clasp output.'); process.exit(1); }
  console.log(`\nPaste into web/js/config.js, API_URLS.${env}:\n  https://script.google.com/macros/s/${newId}/exec`);
  process.exit(0);
}

if (!id) { console.error(`No /exec URL for "${env}" in web/js/config.js. First time? Run with --create.`); process.exit(1); }

clasp('push', '--force');
const v = (/version\D*(\d+)/i.exec(clasp('create-version', desc)) || [])[1];
if (!v) { console.error('Could not read the new version number from clasp output.'); process.exit(1); }
clasp('update-deployment', id, '-V', v, '-d', desc);
console.log(`\n[${env}] Web app now runs version ${v}. Reload the sheet for menu changes.`);
