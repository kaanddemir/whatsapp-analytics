/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves a project site from /<repo>/. Every asset URL Vite emits
// is prefixed with this, so the build works there without a server. Override
// with BASE_PATH=/ for a root or custom-domain deploy.
const base = process.env.BASE_PATH ?? "/whatsapp-analytics/";

// GitHub Pages cannot set response headers, so the policy ships as a meta tag.
// connect-src 'self' is the privacy boundary: the page cannot send chat data
// to another origin. Build-only, because the dev server injects an inline
// React refresh script that 'self' would block.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "csp-meta",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig({
  base,
  // "@/x" -> src/x, mirrored in tsconfig.app.json "paths".
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [react(), contentSecurityPolicy()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    // Source maps would publish the source alongside the app; not needed.
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
