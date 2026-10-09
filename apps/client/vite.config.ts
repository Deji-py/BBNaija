import { defineConfig } from "vite";

// Read by plain Node, which can't load the TypeScript-source @bbn/shared package —
// keep in sync with SERVER_PORT there.
const SERVER_PORT = Number(process.env.GAME_SERVER_PORT ?? 2567);

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: true, // expose on LAN
    // Hostnames used by HTTPS tunnels (needed for mic access off-localhost; see README).
    allowedHosts: [".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"],
    proxy: {
      // The game server is reached through this same origin, so a single URL
      // (and a single HTTPS tunnel) serves both the page and the game connection.
      "/colyseus": {
        target: `http://localhost:${SERVER_PORT}`,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/colyseus/, ""),
      },
    },
  },
});
