import { exploreFilesAsync, MAX_WORKER_COUNT } from "./exploreFilesAsync.ts";

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

await Deno.writeTextFile(
  "./a4s-bak.json",
  JSON.stringify(Object.fromEntries(baks), null, 2),
);

console.log("Backup complete: a4s-bak.json created.");
