/** Check local imports, worker/assets, dependency declarations, cycles and Markdown links. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  ["node_modules", ".git", "dist", ".cache", ".vscode"].includes(e.name) ? [] :
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
const files = walk(root);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const deps = new Set([...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]);
const config = ts.readConfigFile(join(root, "tsconfig.app.json"), ts.sys.readFile);
const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const errors = [], graph = new Map();
const fail = (file, message) => errors.push(`${relative(root, file)}: ${message}`);
const checkImport = (file, name) => {
  if (name.startsWith("node:")) return;
  const clean = name.split("?")[0];
  if (name.startsWith("ort-dist/")) {
    if (!existsSync(join(root, "node_modules/onnxruntime-web/dist", clean.slice(9)))) fail(file, `missing runtime asset ${name}`);
  } else if (name.startsWith(".") || name.startsWith("@/")) {
    const target = ts.resolveModuleName(clean, file, options, ts.sys).resolvedModule?.resolvedFileName;
    const asset = name.startsWith("@/") ? join(root, "src", clean.slice(2)) : resolve(dirname(file), clean);
    if (!target && !existsSync(asset)) fail(file, `unresolved import ${name}`);
    return target;
  } else {
    const dep = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
    if (!deps.has(dep)) fail(file, `undeclared dependency ${dep}`);
  }
};
for (const file of files.filter((f) => /\.(?:[cm]?js|tsx?)$/.test(f))) {
  const text = readFileSync(file, "utf8"), source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const runtime = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = checkImport(file, node.moduleSpecifier.text);
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly : node.isTypeOnly;
      if (target && !typeOnly) runtime.push(target);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      const target = checkImport(file, node.arguments[0].text);
      if (target) runtime.push(target);
    }
    if (ts.isNewExpression(node) && node.expression.getText(source) === "URL" && node.arguments?.length && ts.isStringLiteral(node.arguments[0])) {
      const name = node.arguments[0].text;
      if (name.startsWith(".") && !existsSync(resolve(dirname(file), name))) fail(file, `missing worker or URL asset ${name}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source); graph.set(file, runtime);
  if (relative(root, file).startsWith("src/") && /VITE_LOCAL_ANSWERS|@\/generate\/|QWEN35|llm\.worker|generatorStatus/.test(text)) fail(file, "obsolete generation path");
}
const done = new Set(), active = new Set();
function cycle(file, chain = []) {
  if (active.has(file)) return fail(file, `runtime import cycle: ${[...chain, file].map((f) => relative(root, f)).join(" -> ")}`);
  if (done.has(file)) return;
  active.add(file);
  for (const next of graph.get(file) ?? []) cycle(next, [...chain, file]);
  active.delete(file); done.add(file);
}
for (const file of graph.keys()) cycle(file);
for (const file of files.filter((f) => extname(f) === ".md")) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = match[1].split("#")[0];
    if (href && !/^[a-z]+:/i.test(href) && !existsSync(resolve(dirname(file), decodeURIComponent(href)))) fail(file, `broken documentation link ${href}`);
  }
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`Checked ${graph.size} code files: imports, dependencies, worker/assets, runtime cycles and local documentation links are valid.`);
