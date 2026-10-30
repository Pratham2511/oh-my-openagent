import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, type MemoryIdentity, type ReservedRun } from "@oh-my-opencode/memory-core"
import { reconcilePrelaunch } from "./run-reconciliation-prelaunch"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

describe("prelaunch host identity", () => {
  test.each([
    { name: "same hostname on another machine", recorded: "machine-a", current: "machine-b", hostname: "MacBook-Pro", local: false },
    { name: "same machine after roaming", recorded: "machine-a", current: "machine-a", hostname: "Mac-424", local: true },
    { name: "legacy exact hostname", recorded: undefined, current: "machine-a", hostname: "MacBook-Pro", local: true },
    { name: "legacy other hostname", recorded: undefined, current: "machine-a", hostname: "Mac-424", local: false },
    { name: "unavailable lookup with exact hostname", recorded: "machine-a", current: null, hostname: "MacBook-Pro", local: true },
  ])("#given $name #then only a local reservation is released", async ({ recorded, current, hostname, local }) => {
    const root = await mkdtemp(join(tmpdir(), "reflection-host-"))
    roots.push(root)
    const identity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(root, "agent-test") }
    const active: ReservedRun = {
      runId: "run-1", request: { trigger: "manual", conversationIds: [], snapshots: [] },
      reservedAt: "2026-08-10T00:00:00.000Z", launcherPid: 111,
      launcherHostname: "MacBook-Pro", launcherHostId: recorded,
    }
    let completed = 0
    let probes = 0
    const result = await reconcilePrelaunch({
      identity, hostname: () => hostname, hostId: async () => current,
      now: () => Date.parse("2026-08-10T00:02:00.000Z"),
      getPidLiveness: () => { probes += 1; return "dead" },
      reservation: {
        readState: async () => ({ active }),
        complete: async () => { completed += 1; return { outcome: "failed" } },
      },
    })
    expect(completed).toBe(local ? 1 : 0)
    expect(probes).toBe(local ? 1 : 0)
    expect(result.result?.outcome).toBe(local ? "failed" : undefined)
    if (local) {
      const abandoned = JSON.parse(await readFile(join(identity.paths.reflection, "runs", "run-1", "abandoned.json"), "utf8"))
      expect(abandoned.reason).toBe("launch_interrupted")
    }
  })
})
