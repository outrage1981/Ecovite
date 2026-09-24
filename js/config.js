// The app is served by PocketBase itself (see Dockerfile), so the API lives
// on the same origin the page was loaded from; nothing to fill in.
//
// Add ?demo to the URL (e.g. http://localhost:8080/?demo) to run against
// the in-browser demo data store instead (seeded from js/seedData.js,
// persisted to localStorage), with no server at all.
export const IS_CONFIGURED = !new URLSearchParams(location.search).has('demo');
export const POCKETBASE_URL = IS_CONFIGURED ? location.origin : '';
