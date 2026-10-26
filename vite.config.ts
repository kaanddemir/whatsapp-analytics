import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, createReadStream, existsSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { E5_SMALL } from "./src/semantic/model";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
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
  // ONNX Runtime compiles its WebAssembly; nothing else is relaxed.
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// Search by meaning: the pinned model files, served from this origin (never
// a CDN; the ONNX Runtime files are bundled assets, see model.worker.ts). The
// model is public; it is copied into the build when present locally and
// verified against the pinned SHA-256 first. Without it the app works with
// keyword search and says search by meaning is unavailable.
const MODELS_DIR = process.env.SEMANTIC_MODELS_DIR ?? join(homedir(), ".cache", "wa-phase2", "models");
const TYPES: Record<string, string> = { ".json": "application/json", ".wasm": "application/wasm", ".mjs": "text/javascript", ".onnx": "application/octet-stream" };

/** Hash model files in bounded chunks. */
function sha256File(path: string): string {
  const hash = createHash("sha256"), buf = Buffer.alloc(8 << 20), fd = openSync(path, "r");
  try { for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) hash.update(buf.subarray(0, n)); } finally { closeSync(fd); }
  return hash.digest("hex");
}

function semanticAssets(): Plugin {
  let outDir = "dist";
  // Vitest also runs plugins (with a placeholder outDir): copy only in a real production build.
  let building = false;
  const serve = (prefix: string, dir: string, allowed: (rel: string) => boolean) =>
    (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => {
      const url = req.url?.split("?")[0] ?? "";
      if (!url.startsWith(prefix)) return next();
      let rel: string;
      try { rel = normalize(decodeURIComponent(url.slice(prefix.length))); }
      catch { res.statusCode = 400; return res.end(); }
      const file = join(dir, rel);
      if (rel.startsWith("..") || !allowed(rel) || !existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; return res.end(); }
      res.setHeader("content-type", TYPES[rel.slice(rel.lastIndexOf("."))] ?? "application/octet-stream");
      res.setHeader("content-length", String(statSync(file).size));
      createReadStream(file).pipe(res);
    };
  const modelPath = (rel: string) => [E5_SMALL].some((s) => s.files.some((f) => rel === join(s.repo, f.path)));
  return {
    name: "semantic-assets",
    configResolved(config) { outDir = config.build.outDir; building = config.command === "build" && !process.env.VITEST; },
    configureServer(server) {
      server.middlewares.use(serve(`${base}models/`, MODELS_DIR, modelPath));
    },
    closeBundle() {
      if (!building) return;
      for (const spec of [E5_SMALL]) {
        const missing = spec.files.filter((f) => !existsSync(join(MODELS_DIR, spec.repo, f.path)));
        if (missing.length) {
          // The deploy workflow sets SEMANTIC_MODELS_REQUIRED: a published build without the model is a failure there.
          if (spec === E5_SMALL && process.env.SEMANTIC_MODELS_REQUIRED === "1") throw new Error(`search by meaning: model files not found in ${MODELS_DIR}`);
          this.warn(`${spec.repo}: model files not found in ${MODELS_DIR}; the build serves without it`);
          continue;
        }
        for (const f of spec.files) {
          const src = join(MODELS_DIR, spec.repo, f.path);
          const digest = sha256File(src);
          if (digest !== f.sha256) throw new Error(`model file ${f.path} does not match its pinned SHA-256`);
          const dest = join(outDir, "models", spec.repo, f.path);
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(src, dest);
        }
      }
    },
  };
}

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
  // "ort-dist/x" -> the ONNX Runtime files its package exports do not expose.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)), "ort-dist": fileURLToPath(new URL("./node_modules/onnxruntime-web/dist", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    cors: false,
    fs: { strict: true, allow: [fileURLToPath(new URL(".", import.meta.url))], deny: [".env", ".env.*", "**/*.{crt,pem,key}", "**/.git/**", "**/.aws/**", "**/.codex/**", "**/.agents/**", "**/*.txt", "**/*.zip"] },
  },
  preview: { host: "127.0.0.1", cors: false },
  plugins: [react(), contentSecurityPolicy(), semanticAssets()],
  // The ONNX Runtime files are imported as URLs, not modules. Through the
  // alias they look like a package to the dev dependency optimizer, which
  // tries to pre-bundle the loader and fails on its top-level await, so the
  // dev server never serves it. Transformers.js is imported only from the
  // model worker, on demand, which the startup scan does not see: found late,
  // it would be optimized mid-session and the page reloaded, losing the chat.
  optimizeDeps: { include: ["@huggingface/transformers"], exclude: ["ort-dist"] },
  worker: { format: "es" },
  build: {
    target: "es2022",
    // Source maps would publish the source alongside the app; not needed.
    sourcemap: false,
  },
  test: {
    api: false,
    ui: false,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
