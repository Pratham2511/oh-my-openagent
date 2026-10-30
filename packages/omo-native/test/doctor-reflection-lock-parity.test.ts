import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { REFLECTION_DIR, SCENARIOS, probeFor } from "../../memory-core/src/reflection/stale-holder.scenarios.test-support"
import { classifyReflectionLock } from "../bin/lib/doctor-reflection-lock.js"
import { classifyActiveReflectionHolder } from "../../omo-senpi/src/components/memory/reflection-stale-active"

describe("the session and omo doctor decide a reflection lock the same way (#10377)", () => {
  test.each([
    { name: "another machine with the same hostname", hostname: "this-host", hostId: "machine-b", state: "stuck" },
    { name: "this machine after DHCP roaming", hostname: "Mac-424", hostId: "machine-a", state: "dead" },
  ])("#given $name #then the generated CLI preserves machine identity", async ({ hostname, hostId, state }) => {
    const baseline = SCENARIOS[0]
    if (baseline === undefined) throw new Error("missing dead holder fixture")
    const probe = {
      ...probeFor({
        ...baseline.facts,
        files: {
          ...baseline.facts.files,
          [join(REFLECTION_DIR, "active.lock")]: JSON.stringify({
            runId: "reflection-run-64", launcherPid: 11096,
            launcherHostname: "this-host", launcherHostId: "machine-a",
          }),
        },
      }),
      hostname: () => hostname,
      hostId: async () => hostId,
    }
    const session = await classifyActiveReflectionHolder(REFLECTION_DIR, probe)
    expect(await classifyReflectionLock(REFLECTION_DIR, probe)).toEqual(session)
    expect(session.state).toBe(state)
  })

  test.each(SCENARIOS.map((scenario) => [scenario.name, scenario] as const))(
    "#given %s #when both surfaces classify the holder #then they return the same verdict",
    async (_name, scenario) => {
      const session = await classifyActiveReflectionHolder(REFLECTION_DIR, probeFor(scenario.facts))
      const cli = await classifyReflectionLock(REFLECTION_DIR, probeFor(scenario.facts))
      expect(cli).toEqual(session)
      expect(session).toEqual(scenario.expected)
    },
  )
})
