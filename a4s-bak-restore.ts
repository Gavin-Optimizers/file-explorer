import bak from "./a4s-bak.json" with { type: "json" };

await Promise.all(
  Object.entries(bak).map(async ([path, text]) => {
    console.log(`Restoring ${path}...`);
    await Deno.writeTextFile(path, text);
    console.log(`Restored ${path}`);
  }),
);

console.log(`
Manual steps:
Rebuild Solution in Visual Studio.
Set the startup projects again if needed.
`);
