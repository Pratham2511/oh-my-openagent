import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { relocate, sha256, vendoredPath } from "../scripts/sync-local-api.ts"

// Package contract: the vendored local API is the pinned upstream commit, relocated only by the sync script's rewrites
// (PIN.json). A hand edit of a vendored file fails here; changes go through scripts/sync-local-api.ts in their own PR.
const root = join(import.meta.dir, "..")
type PinnedFile = { readonly upstream: string; readonly upstream_sha256: string; readonly sha256: string }
const pin = JSON.parse(readFileSync(join(root, "PIN.json"), "utf8")) as {
  readonly commit: string
  readonly files: Readonly<Record<string, PinnedFile>>
}

describe("vendored local API pin", () => {
  test("every vendored file is where the sync puts its upstream file, with the pinned bytes", () => {
    expect(pin.commit).toMatch(/^[0-9a-f]{40}$/)
    for (const [target, file] of Object.entries(pin.files)) {
      expect([target, vendoredPath(file.upstream)]).toEqual([target, target])
      expect([target, sha256(readFileSync(join(root, target)))]).toEqual([target, file.sha256])
    }
  })

  test("the relocation rewrites only import specifiers and the two contract paths", () => {
    expect(relocate("test/local-api/conformance/fake-owner.ts", 'import { x } from "../../src/access.ts";')).toBe(
      'import { x } from "../../../src/local-api/access.ts";',
    )
    expect(relocate("src/local-api/limits.ts", 'import { A } from "@sisyphuslabs/relay-spec/proto";')).toBe('import { A } from "./spec-proto.ts";')
    expect(relocate("docs/local-api.md", '"../src/x"')).toBe('"../src/x"')
  })
})
