import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    host: true, // expose on LAN so other devices can connect in later milestones
  },
});
