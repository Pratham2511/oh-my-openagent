import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { classifyReflectionLockHolder } from "./stale-holder"
import { REFLECTION_DIR, SCENARIOS, probeFor } from "./stale-holder.scenarios.test-support"

describe("reflection machine identity (#11822, #11818)", () => {
  test.each([
    { name: "different machines with the same Bonjour name", recorded: "machine-a", current: "machine-b", hostname: "this-host", expected: "stuck" },
    { name: "the same machine after DHCP roaming", recorded: "machine-a", current: "machine-a", hostname: "Mac-424", expected: "dead" },
    { name: "a legacy record on this hostname", recorded: undefined, current: "machine-a", hostname: "this-host", expected: "dead" },
    { name: "a legacy record on another hostname", recorded: undefined, current: "machine-a", hostname: "Mac-424", expected: "stuck" },
    { name: "an unavailable lookup on this hostname", recorded: "machine-a", current: null, hostname: "this-host", expected: "dead" },
    { name: "an unavailable lookup on another hostname", recorded: "machine-a", current: null, hostname: "Mac-424", expected: "stuck" },
  ])("#given $name #then the holder is $expected", async ({ recorded, current, hostname, expected }) => {
    const baseline = SCENARIOS[0]
    if (baseline === undefined) throw new Error("missing dead holder fixture")
    const facts = {
      ...baseline.facts,
      files: {
        ...baseline.facts.files,
        [join(REFLECTION_DIR, "active.lock")]: JSON.stringify({
          runId: "reflection-run-64", launcherPid: 11096, launcherHostname: "this-host",
          ...(recorded === undefined ? {} : { launcherHostId: recorded }),
        }),
      },
    }
    let probes = 0
    const probe = {
      ...probeFor(facts),
      hostname: () => hostname,
      hostId: async () => current,
      getPidLiveness: () => { probes += 1; return "dead" as const },
    }
    expect((await classifyReflectionLockHolder(REFLECTION_DIR, probe)).state).toBe(expected)
    expect(probes).toBe(expected === "stuck" ? 0 : 2)
  })
})
