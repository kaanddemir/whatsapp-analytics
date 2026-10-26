/* Fetches the pinned search-by-meaning model files for a build, verified
   against their SHA-256 (src/semantic/model.ts). Used by the deploy workflow:
   its runner starts without them, and the build would otherwise ship
   keyword search only. Model files are public; no chat data is involved.

   node_modules/.bin/vite-node --root . scripts/fetch-model.ts -- <dir>

   Files already present and correct are kept; a mismatch is an error.
   MODEL_SOURCE replaces https://huggingface.co (a local mirror, or a test server). */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { E5_SMALL } from "../src/semantic/model";

const dir = process.argv[2];
if (!dir) throw new Error("usage: fetch-model.ts <dir>");
const spec = E5_SMALL;
const source = process.env.MODEL_SOURCE ?? "https://huggingface.co";
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

for (const f of spec.files) {
  const dest = join(dir, spec.repo, f.path);
  if (existsSync(dest) && sha(dest) === f.sha256) { console.log(`ok   ${f.path}`); continue; }
  mkdirSync(dirname(dest), { recursive: true });
  const url = `${source}/${spec.repo}/resolve/${spec.revision}/${f.path}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const part = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
  const got = sha(part);
  if (got !== f.sha256) { rmSync(part); throw new Error(`${f.path}: SHA-256 ${got} does not match the pinned ${f.sha256}`); }
  renameSync(part, dest);
  console.log(`got  ${f.path} (${f.bytes} bytes)`);
}
