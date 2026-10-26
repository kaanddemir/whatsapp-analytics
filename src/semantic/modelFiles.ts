/* Model files on this device: fetched once from this app's own origin,
   SHA-256-verified while they stream to the Origin Private File System, and
   read back from there afterwards. A file whose size or recorded digest does
   not match is fetched again; a download whose digest does not match the
   pinned one is deleted and reported, never used.

   Only public model weights and tokenizer files travel here, and only from
   the app's origin to the device. No chat content is involved. */
import { ModelError, type ModelProgress } from "./embedder";
import { modelKey, type ModelFile, type ModelSpec } from "./model";

/** Verified embedding assets in the browser's model cache. */
interface ModelAssets { readonly repo: string; readonly files: readonly ModelFile[]; readonly key: string; readonly folder: string }
const assets = (spec: ModelSpec): ModelAssets => ({ repo: spec.repo, files: spec.files, key: modelKey(spec), folder: "semantic-models" });
import { Sha256 } from "./sha256";
import { isQuota } from "./store";

type Dir = FileSystemDirectoryHandle;

async function folder(root: Dir, spec: ModelAssets, path: string, create: boolean): Promise<{ dir: Dir; file: string }> {
  let dir = await (await root.getDirectoryHandle(spec.folder, { create })).getDirectoryHandle(spec.key, { create });
  const parts = path.split("/");
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
  return { dir, file: parts[parts.length - 1]! };
}

async function verified(root: Dir, spec: ModelAssets, path: string, bytes: number, sha256: string): Promise<File | null> {
  try {
    const { dir, file } = await folder(root, spec, path, false);
    const f = await (await dir.getFileHandle(file)).getFile();
    const marker = await (await dir.getFileHandle(`${file}.sha256`)).getFile();
    if (marker.size > 128) return null;
    const mark = await marker.text();
    if (f.size !== bytes || mark.trim() !== sha256) return null;
    const hash = new Sha256();
    const reader = f.stream().getReader();
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break; hash.update(value); }
    } finally { reader.releaseLock(); }
    return hash.hex() === sha256 ? f : null;
  } catch {
    return null;
  }
}

/** Makes every model file present and verified; resolves with a reader for them. */
export async function ensureModelFiles(
  model: ModelSpec, baseUrl: string, root: Dir, onProgress?: (p: ModelProgress) => void, fetchImpl: typeof fetch = fetch,
): Promise<(path: string) => Promise<File>> {
  const spec = assets(model);
  const total = spec.files.reduce((n, f) => n + f.bytes, 0);
  let loaded = 0;
  const verifiedFiles = new Map<string, File>();
  for (const f of spec.files) {
    const cached = await verified(root, spec, f.path, f.bytes, f.sha256);
    if (cached) { verifiedFiles.set(f.path, cached); loaded += f.bytes; onProgress?.({ phase: "verify", loaded, total }); continue; }
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}models/${spec.repo}/${f.path}`, { credentials: "omit", cache: "no-store", redirect: "error" });
    } catch {
      throw new ModelError("model_missing", "The model files could not be fetched.");
    }
    if (!response.ok || !response.body) throw new ModelError("model_missing", `The model file is not available (${response.status}).`);
    const { dir, file } = await folder(root, spec, f.path, true);
    const handle = await dir.getFileHandle(file, { create: true });
    const writable = await handle.createWritable();
    const hash = new Sha256();
    const reader = response.body.getReader();
    let fileBytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        fileBytes += value.byteLength;
        if (fileBytes > f.bytes) throw new ModelError("integrity", "Model file exceeds its pinned size.");
        hash.update(value);
        await writable.write(value);
        loaded += value.byteLength;
        onProgress?.({ phase: "download", loaded, total });
      }
      if (fileBytes !== f.bytes) throw new ModelError("integrity", "Model file size does not match its manifest.");
      await writable.close();
    } catch (error) {
      await reader.cancel().catch(() => {});
      await writable.abort().catch(() => {});
      await dir.removeEntry(file).catch(() => {});
      if (error instanceof ModelError) throw error;
      if (isQuota(error)) throw new ModelError("storage_full", "Not enough storage space for the model.");
      throw new ModelError("model_missing", "The model download was interrupted.");
    } finally { reader.releaseLock(); }
    const digest = hash.hex();
    if (digest !== f.sha256) {
      await dir.removeEntry(file).catch(() => {});
      throw new ModelError("integrity", `Model file ${f.path} failed its integrity check.`);
    }
    const mark = await (await dir.getFileHandle(`${file}.sha256`, { create: true })).createWritable();
    await mark.write(new TextEncoder().encode(digest));
    await mark.close();
    verifiedFiles.set(f.path, await handle.getFile());
  }
  return async (path: string) => {
    const f = spec.files.find((x) => x.path === path);
    const file = f && verifiedFiles.get(path);
    if (!file) throw new ModelError("integrity", `Model file ${path} is missing.`);
    return file;
  };
}
