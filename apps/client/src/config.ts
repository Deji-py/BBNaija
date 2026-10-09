import { SERVER_PORT } from "@bbn/shared";

/** HTTP base URL of the game server, on the same host the page was loaded from. */
export const SERVER_HTTP_URL =
  import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:${SERVER_PORT}`;
