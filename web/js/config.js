// Web app (/exec) URL per environment: Apps Script → Deploy → Manage deployments → Web app URL.
// Not secrets (the script is the gatekeeper). The page picks its environment from the host it is served on,
// so one committed file serves dev and prod. tools/deploy-api.mjs reads the deployment ID from API_URLS too.
export const API_URLS = {
  dev: 'https://script.google.com/macros/s/AKfycbyi_gn7hAHtIaUPYUN4fjMr7rDaq9hpdVBLfRv2rYp6BqWj98R5G7MDugiiUKyilQvT/exec',
  staging: 'https://script.google.com/macros/s/AKfycbzcbc-KRhS46HpQg2zhCt8xtkXx5BiM_qo_OQ4uSSJSsEGNYoK_ppR4zaoYITfZF5_zLA/exec',   // STAGING sheet replaced 2026-10-19
  prod: 'https://script.google.com/macros/s/AKfycbz7O6NXolKqz1SmDvfb5mZpIC44g6Z6UqEX1BoX8bmrevdX3omdtLjOacvGb5C-n1Sy/exec'
};

// Host → environment. An unknown host gets no API (fails loudly instead of talking to the wrong sheet).
const HOSTS = {
  'ccac-eagle-tracker-dev.web.app': 'dev',
  'ccac-eagle-tracker-dev.firebaseapp.com': 'dev',
  'localhost': 'dev',
  '127.0.0.1': 'dev',
  'cc-eagle-tracker-staging.web.app': 'staging',
  'cc-eagle-tracker-staging.firebaseapp.com': 'staging',
  'cc-eagle-tracker.web.app': 'prod',
  'cc-eagle-tracker.firebaseapp.com': 'prod',
  'cc.svmbc.org': 'prod',
  'ccac.svmbc.org': 'prod',                    // custom domains (Firebase Hosting → Add custom domain; DNS by the Council)
  'ccac-staging.svmbc.org': 'staging'
};

const host = (globalThis.location && globalThis.location.hostname) || '';
export const ENV = HOSTS[host] || '';
export const API_URL = ENV ? API_URLS[ENV] : '';

// "Test site" note on every page, never on production (or an unknown host).
if (globalThis.document && ENV && ENV !== 'prod') {
  globalThis.document.querySelectorAll('.env-note').forEach((el) => {
    el.textContent = ENV === 'dev' ? 'Development site: use fake data only.'
      : 'Staging (test) site: not the live site. Emails go only to the committee\'s test address.';
    el.hidden = false;
  });
}
