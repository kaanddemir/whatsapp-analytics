import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("does not pass a behavior with a large formal/informal gap despite good overall precision and recall", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const output = execFileSync(`${root}node_modules/.bin/vite-node`, ["scripts/evaluate-behaviour.ts", "--", "blind"], { cwd: root, encoding: "utf8" });
  const report = JSON.parse(output.split("\n")[0]!);
  const cancellation = report.cells["cancellation.tr"];
  expect(cancellation.precision).toBeGreaterThan(0.9);
  expect(cancellation.recall).toBeGreaterThan(0.8);
  expect(cancellation.recallGap).toBeGreaterThan(0.1);
  expect(cancellation.passes).toBe(false);
  expect(report.cells["acceptance.tr"].passes).toBe(true);
});
