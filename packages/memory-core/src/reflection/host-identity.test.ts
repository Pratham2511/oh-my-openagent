import { describe, expect, test } from "bun:test"

import { createReflectionHostIdReader } from "./host-identity"

describe("reflection host lookup cache", () => {
  test.each(["timeout", "unavailable"] as const)("#given an initial %s #when read again #then the lookup retries and only success is cached", async (failure) => {
    let calls = 0
    const read = createReflectionHostIdReader(async () => {
      calls += 1
      if (calls === 1) {
        if (failure === "timeout") throw Object.assign(new Error("lookup timed out"), { code: "ETIMEDOUT" })
        return null
      }
      return "platform-machine-a"
    })
    expect(await read()).toBeNull()
    const id = await read()
    expect(id).toMatch(/^[a-f0-9]{64}$/)
    expect(id).not.toContain("platform-machine-a")
    expect(await read()).toBe(id)
    expect(calls).toBe(2)
  })

  test("#given concurrent first readers #then they share one lookup", async () => {
    const lookup = Promise.withResolvers<string | null>()
    let calls = 0
    const read = createReflectionHostIdReader(() => { calls += 1; return lookup.promise })
    const first = read()
    const second = read()
    lookup.resolve("platform-machine-a")
    expect(await first).toBe(await second)
    expect(calls).toBe(1)
  })
})
