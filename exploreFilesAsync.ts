import { Buffer } from "node:buffer";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * @package file-explorer
 *
 * This package exposes exploreFilesAsync, which you can use to do things
 * that the unix utility find would do, but in JavaScript/TypeScript.
 *
 * @example
 *
 * ```
 * const allTypescriptFileIterator = exploreFilesAsync({
 * rootDir: import.meta.dirname!,
 * shouldExploreDir: (path) =>
 *   !path.endsWith(".git") && !path.endsWith("node_modules"),
 * shouldReadFile: (file) => file.path.endsWith(".ts"),
 * });
 *
 * for await (const file of allTypescriptFileIterator) {
 *   const path = file.path;
 *   const text = file.contents.asString();
 *   console.log({path, text});
 * }
 * ```
 */

export type ExploreFileArgs = {
  rootDir: string;
  shouldExploreDir: (path: string) => boolean;
  shouldReadFile: (file: FileWithoutContents) => boolean;
  shouldYieldFile?: (file: FileWithContents) => boolean;
  workerCount?: number;
};

export type FileWithoutContents = {
  path: string;
};

export type FileWithContents = {
  path: string;
  contents: FileReader;
};

export type FileReader = {
  asText(): string;
};

export const MAX_WORKER_COUNT = 8;

/**
 * Creates an unordered async iterator over files in your filesystem.
 *
 * Each statted FileWithoutContents is passed to the shouldReadFile
 * predicate. If this predicate returns true, the file is read from disk. The
 * read files are passed to the shouldYieldFile predicate. If shouldYieldFile
 * returns true or if this predicate is not defined, the FileWithContents is
 * yielded to you.
 *
 * Each statted directory is passed to the shouldExploreDir predicate. If the
 * predicate returns true, this directory is examined just as the rootDir was.
 */
export async function* exploreFilesAsync(
  options: ExploreFileArgs,
): AsyncIterable<FileWithContents> {
  const {
    rootDir,
    shouldExploreDir,
    shouldReadFile,
    shouldYieldFile = () => true,
    workerCount = 1,
  } = options;

  // --- 1. Validation Logic ---
  let maxWorkers = 1; // Default if undefined

  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new Error("workerCount must be a positive integer.");
  }
  maxWorkers = Math.min(workerCount, MAX_WORKER_COUNT);

  // --- 2. Shared State / Queues ---

  // Priority 1: Check contents and ready for yield
  const queueYieldCheck: FileWithContents[] = [];
  // Priority 2: Read from disk
  const queueRead: FileWithoutContents[] = [];
  // Priority 3: Check file predicate
  const queueFileCheck: FileWithoutContents[] = [];
  // Priority 4: Stat directory (readdir)
  const queueDirStat: string[] = [rootDir]; // Initial state
  // Priority 5: Check dir predicate
  const queueDirCheck: string[] = [];

  // Output buffer for the generator to consume
  const outputBuffer: FileWithContents[] = [];

  // Synchronization primitives
  let activeWorkers = 0;
  let isDone = false;
  let error: unknown = null;

  // Resolvers to wake up sleeping components
  const workerWaiters: (() => void)[] = [];
  let generatorWaiter: (() => void) | null = null;

  // --- 3. Helper Functions ---

  const notifyWorkers = () => {
    // If there are sleeping workers, wake one up per notification,
    // or wake them all (simpler logic: wake one if work available).
    // Given the unpredictable nature of tasks, we usually wake as many as needed.
    // Here we wake all idle workers to race for the new work.
    while (workerWaiters.length > 0) {
      const resolve = workerWaiters.shift();
      resolve?.();
    }
  };

  const notifyGenerator = () => {
    if (generatorWaiter) {
      const resolve = generatorWaiter;
      generatorWaiter = null;
      resolve();
    }
  };

  const createFileReader = (buffer: Buffer): FileReader => ({
    asText: () => buffer.toString("utf-8"),
  });

  // --- 4. Worker Logic ---

  const workerLoop = async () => {
    while (true) {
      if (error) return;

      // --- Priority 1: shouldYieldFile & Yielding ---
      // Note: "Yielding" technically puts it in the outputBuffer for the generator.
      if (queueYieldCheck.length > 0) {
        const file = queueYieldCheck.shift()!;
        try {
          if (shouldYieldFile(file)) {
            outputBuffer.push(file);
            notifyGenerator();
          }
        } catch (e) {
          error = e;
          notifyGenerator();
        }
        continue;
      }

      // --- Priority 2: Read files ---
      if (queueRead.length > 0) {
        const fileCtx = queueRead.shift()!;
        try {
          const buffer = await fs.readFile(fileCtx.path);
          queueYieldCheck.push({
            path: fileCtx.path,
            contents: createFileReader(buffer),
          });
          notifyWorkers(); // New work for Priority 1
        } catch (e) {
          error = e;
          notifyGenerator();
        }
        continue;
      }

      // --- Priority 3: Test shouldReadFile ---
      if (queueFileCheck.length > 0) {
        const fileCtx = queueFileCheck.shift()!;
        try {
          if (shouldReadFile(fileCtx)) {
            queueRead.push(fileCtx);
            notifyWorkers(); // New work for Priority 2
          }
        } catch (e) {
          error = e;
          notifyGenerator();
        }
        continue;
      }

      // --- Priority 4: Stat/Read Directory ---
      if (queueDirStat.length > 0) {
        const dirPath = queueDirStat.shift()!;
        try {
          // We use withFileTypes to get types immediately to sort into Next Queues
          const entries = await fs.readdir(dirPath, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
              queueDirCheck.push(fullPath); // Goes to Priority 5
            } else if (entry.isFile()) {
              queueFileCheck.push({ path: fullPath }); // Goes to Priority 3
            }
          }
          // We added work to 3 and 5.
          if (entries.length > 0) notifyWorkers();
        } catch (e) {
          error = e;
          notifyGenerator();
        }
        continue;
      }

      // --- Priority 5: Test shouldExploreDir ---
      if (queueDirCheck.length > 0) {
        const dirPath = queueDirCheck.shift()!;
        try {
          if (shouldExploreDir(dirPath)) {
            queueDirStat.push(dirPath); // Goes to Priority 4
            notifyWorkers();
          }
        } catch (e) {
          error = e;
          notifyGenerator();
          return;
        }
        continue;
      }

      // --- No Work Available ---
      activeWorkers--;

      // Check Termination Condition
      const allQueuesEmpty = queueYieldCheck.length === 0 &&
        queueRead.length === 0 &&
        queueFileCheck.length === 0 &&
        queueDirStat.length === 0 &&
        queueDirCheck.length === 0;

      if (activeWorkers === 0 && allQueuesEmpty) {
        isDone = true;
        notifyGenerator(); // Wake generator to finish
        notifyWorkers(); // Wake other workers so they can exit
        return;
      }

      // Wait for work
      await new Promise<void>((resolve) => workerWaiters.push(resolve));
      activeWorkers++;
    }
  };

  // --- 5. Start Workers ---

  // We start 'active' because they will immediately look for work.
  // Although technically they start running, decrement, and wait if empty.
  // rootDir is already in queueDirStat, so at least one worker picks it up.
  activeWorkers = maxWorkers;
  for (let i = 0; i < maxWorkers; i++) {
    workerLoop();
  }

  // --- 6. Generator Loop ---

  while (true) {
    if (outputBuffer.length > 0) {
      yield outputBuffer.shift()!;
      continue;
    }

    if (error) {
      throw error;
    }

    if (isDone) {
      return;
    }

    // Wait for data or completion
    await new Promise<void>((resolve) => {
      generatorWaiter = resolve;
    });
  }
}
