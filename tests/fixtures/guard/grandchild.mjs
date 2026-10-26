// Fixture: spawns a long-lived grandchild, writes its pid to argv[2], then idles.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const g = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { stdio: "ignore" });
writeFileSync(process.argv[2], String(g.pid));
await new Promise((r) => setTimeout(r, 120_000));
