import { exploreFilesAsync, MAX_WORKER_COUNT } from "./exploreFilesAsync.ts";
import { md5 } from "./md5.ts";

const sourcesIterator = exploreFilesAsync({
  rootDir: "C:\\Git\\App4Sales-Backend",
  shouldExploreDir: (path) =>
    !path.endsWith(".git") && !path.endsWith("node_modules"),
  shouldReadFile: (file) => file.path.endsWith(".user"),
  workerCount: MAX_WORKER_COUNT,
});

const baks = new Map<string, string>();

for await (const file of sourcesIterator) {
  const path = file.path;
  const text = file.contents.asText();
  baks.set(path, text);
  console.log(`Backing up ${path}...`);
}

const toWrite = JSON.stringify(Object.fromEntries(baks), null, 2);

await Promise.all([
  Deno.writeTextFile(
    "./a4s-bak.json",
    toWrite,
  ),
  Deno.writeTextFile(md5(toWrite) + ".hashed.json", toWrite),
]);

console.log("Backup complete: a4s-bak.json created.");
