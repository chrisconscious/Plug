/**
 * Local disk storage — writes under `<uploads-dir>/<subdir>/`.
 *
 * PRODUCTION WARNING: this is NOT safe across multiple server instances.
 * Each instance has its own local filesystem — an upload handled by
 * instance A is invisible to instance B, which will 404 on it, and a
 * horizontally-scaled or serverless deployment will behave inconsistently
 * depending purely on which instance happens to handle which request. This
 * implementation exists for local development only. Set
 * `STORAGE_PROVIDER=s3` (see s3-provider.ts and .env.example) for any
 * deployment with more than one running instance.
 */
import { mkdir, readdir, readFile, rm, writeFile, stat } from "fs/promises";
import { dirname, resolve, relative, sep } from "path";
import type { StorageProvider, StoredObject } from "./provider";

export class LocalDiskStorageProvider implements StorageProvider {
  readonly name = "local-disk";
  private readonly dir: string;
  private readonly publicBase: string;

  constructor(options: { dir: string; publicPath: string }) {
    this.dir = resolve(options.dir);
    this.publicBase = options.publicPath;
  }

  private pathFor(key: string): string {
    // Guard against path traversal: storage keys are server-generated UUIDs,
    // but never trust that — reject keys that escape the base directory.
    const full = resolve(this.dir, ...key.split("/"));
    if (full !== this.dir && !full.startsWith(this.dir + sep)) {
      throw new Error("Invalid storage key (path traversal attempt).");
    }
    return full;
  }

  async put(key: string, data: Buffer, _opts: { contentType: string }): Promise<StoredObject> {
    const full = this.pathFor(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return { storageKey: key, url: `${this.publicBase}/${key}` };
  }

  async delete(key: string): Promise<void> {
    const full = this.pathFor(key);
    await rm(full, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    const full = this.pathFor(key);
    try {
      await readFile(full);
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const startDir = prefix ? this.pathFor(prefix) : this.dir;
    const out: string[] = [];
    async function walk(dir: string) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // directory doesn't exist yet — nothing to list
      }
      for (const entry of entries) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else out.push(full);
      }
    }
    if ((await stat(startDir).catch(() => null))?.isDirectory()) {
      await walk(startDir);
    } else if (await stat(startDir).catch(() => null)) {
      out.push(startDir);
    }
    return out.map((f) => relative(this.dir, f).split(sep).join("/"));
  }
}
