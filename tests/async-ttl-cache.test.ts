import assert from "node:assert/strict";
import test from "node:test";
import { createAsyncTtlCache } from "../lib/asyncTtlCache";

test("async TTL cache shares an in-flight load and expires it", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = createAsyncTtlCache<string, number>({
    ttlMs: 100,
    now: () => now,
  });
  const load = async () => ++loads;

  const [first, second] = await Promise.all([
    cache.get("user-1", load),
    cache.get("user-1", load),
  ]);
  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.equal(loads, 1);

  now += 101;
  assert.equal(await cache.get("user-1", load), 2);
});

test("async TTL cache does not retain rejected loaders", async () => {
  let attempts = 0;
  const cache = createAsyncTtlCache<string, string>({ ttlMs: 100 });

  await assert.rejects(
    cache.get("user-1", async () => {
      attempts += 1;
      throw new Error("temporary failure");
    }),
  );

  assert.equal(
    await cache.get("user-1", async () => {
      attempts += 1;
      return "recovered";
    }),
    "recovered",
  );
  assert.equal(attempts, 2);
});
