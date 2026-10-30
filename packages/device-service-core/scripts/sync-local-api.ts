#!/usr/bin/env bun
// Vendors the device service's local API v1 from a checkout of the device-service repository at one commit: the
// package's sources (src/local-api/), its own contract tests and reference server (test/local-api/, run by omo CI
// against the vendored copy) and the contract document (docs/local-api.md), then writes PIN.json.
//   bun packages/device-service-core/scripts/sync-local-api.ts <device-service checkout> [<commit>]
// Run it in its own PR. local-api-pin.test.ts fails on any hand edit of a vendored file.
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, posix } from "node:path"

const PACKAGE_ROOT = join(import.meta.dir, "..")
const SOURCE_REPO = "sisyphuslabs/omo-relay-daemon"
const SPEC_IMPORT = '"@sisyphuslabs/relay-spec/proto"'
const SPEC_PROTO = "src/local-api/spec-proto.ts"

/** Upstream test files left out, with the reason PIN.json records. */
const EXCLUDED: Readonly<Record<string, string>> = {
  "packages/local-api/src/index.ts": "the package barrel; omo imports the modules it uses directly",
  "packages/local-api/test/vocabulary-drift.test.ts":
    "compares the vocabulary with the whole spec package, which is not vendored; the sync checks the constants the client uses",
}
const SPEC_FILES = {
  SESSION_BLOB_MAX: "session-blob.ts",
  SESSION_COMMAND_TEXT_MAX_CHARS: "session-command.ts",
  SESSION_COMMAND_TEXT_MAX_BYTES: "session-command.ts",
  SESSION_UI_REQUEST_ID_MAX_CHARS: "session-command.ts",
  SESSION_QUESTION_ANSWERS_MAX: "session-command.ts",
  SESSION_ANSWER_SELECTED_MAX: "session-command.ts",
  SESSION_DEVICE_MAX_CHARS: "session-inner.ts",
  SESSION_PROJECT_MAX_CHARS: "session-inner.ts",
  SESSION_ID_MAX_CHARS: "session-inner.ts",
  SESSION_READ_TAIL_MAX: "session-read.ts",
  SESSION_SUMMARY_TITLE_MAX_CHARS: "session-summary.ts",
  SESSION_SUMMARY_PROJECT_MAX_CHARS: "session-summary.ts",
  SESSION_SUMMARY_PATH_MAX_CHARS: "session-summary.ts",
} as const

export const sha256 = (bytes: string | Uint8Array): string => createHash("sha256").update(bytes).digest("hex")

const constantValue = (source: string, name: string): string | undefined =>
  new RegExp(`export const ${name} = ([0-9_]+);`).exec(source)?.[1]?.replaceAll("_", "")

/** Where an upstream file lands in this package, or undefined when it is not vendored. */
export function vendoredPath(upstream: string): string | undefined {
  if (upstream === "docs/local-api.md") return "docs/local-api.md"
  if (upstream in EXCLUDED) return undefined
  if (upstream.startsWith("packages/local-api/src/") && upstream.endsWith(".ts"))
    return `src/local-api/${upstream.slice("packages/local-api/src/".length)}`
  if (upstream.startsWith("packages/local-api/test/")) return `test/local-api/${upstream.slice("packages/local-api/test/".length)}`
  return undefined
}

/** The deterministic rewrites that relocate an upstream file; nothing else in it changes. */
export function relocate(target: string, text: string): string {
  if (!target.endsWith(".ts")) return text
  const fromDir = posix.dirname(target)
  let spec = posix.relative(fromDir, SPEC_PROTO)
  if (!spec.startsWith(".")) spec = `./${spec}`
  let out = text.replaceAll(SPEC_IMPORT, `"${spec}"`)
  if (target.startsWith("test/local-api/conformance/")) out = out.replaceAll('"../../src/', '"../../../src/local-api/')
  else if (target.startsWith("test/local-api/")) out = out.replaceAll('"../src/', '"../../src/local-api/')
  if (target === "test/local-api/la18-shutdown-for-upgrade.test.ts")
    out = out
      .replace('join(import.meta.dir, "..", "src")', 'join(import.meta.dir, "..", "..", "src", "local-api")')
      .replace('join(import.meta.dir, "..", "..", "..", "docs", "local-api.md")', 'join(import.meta.dir, "..", "..", "docs", "local-api.md")')
  return out
}

async function git(checkout: string, args: readonly string[]): Promise<string> {
  const child = Bun.spawn(["git", "-C", checkout, ...args], { stdout: "pipe", stderr: "pipe" })
  const [text, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed (exit ${code})`)
  return text
}

async function main(argv: readonly string[]): Promise<void> {
  const [checkout, commitArg = "HEAD"] = argv
  if (!checkout) throw new Error("usage: sync-local-api.ts <device-service checkout> [<commit>]")
  const commit = (await git(checkout, ["rev-parse", "--verify", `${commitArg}^{commit}`])).trim()
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`cannot resolve ${commitArg}`)

  const specProto = readFileSync(join(PACKAGE_ROOT, SPEC_PROTO), "utf8")
  const spec: Record<string, string> = {}
  for (const [name, file] of Object.entries(SPEC_FILES)) {
    const path = `vendor/relay-spec/packages/relay-proto/src/${file}`
    const upstream = await git(checkout, ["show", `${commit}:${path}`])
    spec[path] = sha256(upstream)
    const want = constantValue(upstream, name)
    const have = constantValue(specProto, name)
    if (want === undefined || want !== have) throw new Error(`${name}: spec says ${want}, spec-proto.ts says ${have}`)
  }

  for (const dir of ["test/local-api", "docs"]) rmSync(join(PACKAGE_ROOT, dir), { recursive: true, force: true })
  const listed = (await git(checkout, ["ls-tree", "-r", "--name-only", commit, "packages/local-api", "docs/local-api.md"])).trim().split("\n")
  const files: Record<string, { readonly upstream: string; readonly upstream_sha256: string; readonly sha256: string }> = {}
  for (const upstream of listed) {
    const target = vendoredPath(upstream)
    if (target === undefined) continue
    const original = await git(checkout, ["show", `${commit}:${upstream}`])
    const text = relocate(target, original)
    mkdirSync(dirname(join(PACKAGE_ROOT, target)), { recursive: true })
    writeFileSync(join(PACKAGE_ROOT, target), text)
    files[target] = { upstream, upstream_sha256: sha256(original), sha256: sha256(text) }
  }
  const pin = { source: SOURCE_REPO, commit, excluded: EXCLUDED, spec, files }
  writeFileSync(join(PACKAGE_ROOT, "PIN.json"), `${JSON.stringify(pin, null, 2)}\n`)
  console.log(`LOCAL_API_SYNCED ${commit} files=${Object.keys(files).length}`)
}

if (import.meta.main) await main(Bun.argv.slice(2))
