/**
 * Game server base URL. Development goes through Vite's `/colyseus` proxy.
 * The production image serves the built client and Colyseus from the same
 * origin, so it connects directly to that origin unless explicitly overridden.
 */
export const SERVER_HTTP_URL =
  import.meta.env.VITE_SERVER_URL ?? (import.meta.env.PROD ? location.origin : `${location.origin}/colyseus`);
