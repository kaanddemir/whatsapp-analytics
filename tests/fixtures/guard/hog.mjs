// Fixture: grows resident memory to argv[2] MB, then idles (the guard should stop it first).
const mb = Number(process.argv[2] ?? 300), keep = [];
for (let i = 0; i < mb; i += 16) { keep.push(Buffer.alloc(16 * 2 ** 20, 1)); await new Promise((r) => setTimeout(r, 20)); }
await new Promise((r) => setTimeout(r, 60_000));
