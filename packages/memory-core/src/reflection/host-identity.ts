import { createHash } from "node:crypto"
import { hostname } from "node:os"

import { platformMachineId } from "../sync/item/machine-id"

export interface ReflectionHostProbe {
  readonly hostname?: () => string
  readonly hostId?: () => Promise<string | null>
}

// PID liveness is machine-scoped: two installs on one machine must agree, whereas a copied
// state directory on another machine must not. Do not persist the raw platform identifier.
export function createReflectionHostIdReader(lookup: () => Promise<string | null> = platformMachineId): () => Promise<string | null> {
  let cached: string | undefined
  let pending: Promise<string | null> | undefined
  return () => {
    if (cached !== undefined) return Promise.resolve(cached)
    pending ??= lookup().then((id) => {
      if (id === null || id.trim() === "") return null
      cached = createHash("sha256").update(`omo-reflection-host:v1:${id}`).digest("hex")
      return cached
    }).catch(() => null).finally(() => { pending = undefined })
    return pending
  }
}

export const getReflectionHostId = createReflectionHostIdReader()

export async function isLocalReflectionHost(
  record: { readonly launcherHostname?: string; readonly launcherHostId?: string },
  probe: ReflectionHostProbe = {},
): Promise<boolean> {
  if (record.launcherHostId !== undefined) {
    const localId = await (probe.hostId ?? getReflectionHostId)()
    if (localId !== null) return record.launcherHostId === localId
  }
  // Legacy records and failed/timed-out lookups retain the exact-hostname rule. No patterns.
  return record.launcherHostname === (probe.hostname ?? hostname)()
}
