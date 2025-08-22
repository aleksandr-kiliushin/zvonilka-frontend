import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
    open: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          "peer-vendor": ["peerjs"],
        },
      },
    },
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["peerjs"],
  },
});
