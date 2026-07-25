import { cp, mkdir, rm, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const output = new URL("../_site/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const item of ["index.html", "styles.css", "app.js", "data"]) {
  await cp(new URL(item, root), new URL(item, output), { recursive: true });
}
await writeFile(new URL(".nojekyll", output), "", "utf8");
console.log("Static site built in _site/");
