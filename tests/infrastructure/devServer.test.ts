/* The dev server serves what search by meaning needs (vite.config.ts,
   optimizeDeps). The ONNX Runtime loader and WASM are imported by URL through
   the "ort-dist" alias; left to the dependency optimizer, the loader was
   pre-bundled, failed on its top-level await and was never served, so the
   real model worked in a build but not under `npm run dev`. Checked with a
   fresh, private cache so the result never depends on an earlier run. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";

const ROOT = join(__dirname, "../..");
let server: ViteDevServer;
let cacheDir: string;

beforeAll(async () => {
  cacheDir = mkdtempSync(join(tmpdir(), "wa-vite-"));
  server = await createServer({ configFile: join(ROOT, "vite.config.ts"), root: ROOT, cacheDir, logLevel: "silent", server: { middlewareMode: true, ws: false } });
}, 60_000);
afterAll(async () => {
  await server?.close();
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("dev server", () => {
  it("serves the ONNX Runtime files as they are, not through the dependency optimizer", async () => {
    const worker = await server.transformRequest("/src/semantic/model.worker.ts");
    const urls = [...worker!.code.matchAll(/"([^"]*ort-wasm-simd-threaded\.asyncify\.(?:mjs|wasm)[^"]*)"/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThanOrEqual(2);
    for (const url of urls) expect(url).not.toMatch(/\.vite|deps\//);
    // Each one is a URL module naming a real file in the package.
    for (const url of urls) {
      const module = await server.transformRequest(url.replace(/^\/whatsapp-analytics/, ""));
      const file = /export default "\/whatsapp-analytics\/([^"?]+)"/.exec(module!.code)?.[1];
      expect(file && existsSync(join(ROOT, file))).toBe(true);
    }
  }, 60_000);

  it("optimizes Transformers.js at startup, so finding it in the model worker never reloads the page", () => {
    expect(server.config.optimizeDeps.include).toContain("@huggingface/transformers");
  });
});
