import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { rm, readFile } from "fs/promises";
import { resolve } from "path";
import { LocalDiskStorageProvider } from "./local-disk-provider";

const TEST_DIR = resolve(__dirname, "__test-tmp__local-disk-provider");

function makeProvider() {
  return new LocalDiskStorageProvider({ dir: TEST_DIR, publicPath: "/uploads/test" });
}

beforeEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("LocalDiskStorageProvider", () => {
  it("put() writes the file and returns the correct storageKey/url", async () => {
    const p = makeProvider();
    const result = await p.put("abc-123.png", Buffer.from("hello"), { contentType: "image/png" });
    expect(result.storageKey).toBe("abc-123.png");
    expect(result.url).toBe("/uploads/test/abc-123.png");
  });

  it("the written file's content round-trips exactly", async () => {
    const p = makeProvider();
    await p.put("file.txt", Buffer.from("exact content"), { contentType: "text/plain" });
    const content = await readFile(resolve(TEST_DIR, "file.txt"));
    expect(content.toString()).toBe("exact content");
  });

  it("exists() is true after put and false for an unknown key", async () => {
    const p = makeProvider();
    await p.put("known.png", Buffer.from("x"), { contentType: "image/png" });
    expect(await p.exists("known.png")).toBe(true);
    expect(await p.exists("unknown.png")).toBe(false);
  });

  it("delete() removes the file — exists() reflects it afterward", async () => {
    const p = makeProvider();
    await p.put("to-delete.png", Buffer.from("x"), { contentType: "image/png" });
    await p.delete("to-delete.png");
    expect(await p.exists("to-delete.png")).toBe(false);
  });

  it("delete() is idempotent — deleting an already-deleted (or never-existing) key does not throw", async () => {
    const p = makeProvider();
    await expect(p.delete("never-existed.png")).resolves.not.toThrow();
  });

  it("rejects a path-traversal attempt in the key rather than writing outside its directory", async () => {
    const p = makeProvider();
    await expect(p.put("../../etc/passwd", Buffer.from("x"), { contentType: "text/plain" })).rejects.toThrow(/path traversal/);
  });

  it("list() returns every key, including nested ones, with forward-slash paths", async () => {
    const p = makeProvider();
    await p.put("sub/one.png", Buffer.from("a"), { contentType: "image/png" });
    await p.put("sub/two.png", Buffer.from("b"), { contentType: "image/png" });
    await p.put("three.png", Buffer.from("c"), { contentType: "image/png" });
    const listed = (await p.list()).sort();
    expect(listed).toEqual(["sub/one.png", "sub/two.png", "three.png"].sort());
  });

  it("list(prefix) scopes results to that subdirectory only", async () => {
    const p = makeProvider();
    await p.put("sub/one.png", Buffer.from("a"), { contentType: "image/png" });
    await p.put("sub/two.png", Buffer.from("b"), { contentType: "image/png" });
    await p.put("three.png", Buffer.from("c"), { contentType: "image/png" });
    const listed = (await p.list("sub")).sort();
    expect(listed).toEqual(["sub/one.png", "sub/two.png"].sort());
  });

  it("list() on an empty/nonexistent directory returns an empty array rather than throwing", async () => {
    const p = makeProvider();
    await expect(p.list()).resolves.toEqual([]);
  });
});
