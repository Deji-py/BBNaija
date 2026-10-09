/**
 * Game server base URL. In development the Vite dev server proxies `/colyseus`
 * to the game server, so the page and the game share one origin. Set
 * VITE_SERVER_URL to point somewhere else (e.g. production in M9).
 */
export const SERVER_HTTP_URL = import.meta.env.VITE_SERVER_URL ?? `${location.origin}/colyseus`;
