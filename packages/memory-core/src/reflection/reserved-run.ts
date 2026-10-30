import type { ReflectionRequest } from "./machine"

export interface ReservedRun {
  readonly runId: string
  readonly request: ReflectionRequest
  readonly reservedAt?: string
  readonly launcherPid?: number
  readonly launcherHostname?: string
  readonly launcherHostId?: string
  readonly launcherProcessStart?: string | null
}
