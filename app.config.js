// Dynamic Expo config. The static config in app.json stays the source of truth —
// this only overlays the Android Firebase file so the API-key-bearing
// google-services.json is NEVER committed (CLAUDE.md §3): on EAS it comes from the
// GOOGLE_SERVICES_JSON file env var (materialized to a path at build time); locally
// it falls back to ./google-services.json (gitignored). Everything else (name, slug,
// plugins, extra.eas, owner, …) is inherited unchanged from app.json via `config`.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
