import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { appendRegistryEntry, parseProjectConfig, parseRegistry } from "./register-with-playbook.mjs";

test("project configuration derives enrolled categories from concrete stages", () => {
  const config = parseProjectConfig("project_type: product\nstages:\n  - stage:triage\n  - stage:in-progress\n  - stage:in-review\ngates:\n  state_guard: false\n");
  assert.deepEqual(config.categories, ["labels", "issue-lifecycle"]);
  assert.throws(() => parseProjectConfig('project_type: "[product | template]"\nstages:\n  - stage:triage\n'), /concrete/);
});

test("registry registration is idempotent and conflicting duplicates fail", () => {
  const source = "# Registry policy\nversion: 1\nrepositories:\n  - name: existing\n    categories: [issue-lifecycle, labels]\n";
  assert.deepEqual(parseRegistry(source), [{ name: "existing", categories: ["issue-lifecycle", "labels"] }]);
  assert.equal(appendRegistryEntry(source, { name: "existing", categories: ["labels", "issue-lifecycle"] }).changed, false);
  assert.throws(
    () => appendRegistryEntry(source, { name: "existing", categories: ["labels"] }),
    /different categories/,
  );
  const added = appendRegistryEntry(source, { name: "new-repo", categories: ["labels", "issue-lifecycle"] });
  assert.equal(added.changed, true);
  assert.match(added.source, /# Registry policy/);
  assert.match(added.source, /name: new-repo/);
  assert.deepEqual(parseRegistry(added.source).at(-1), {
    name: "new-repo",
    categories: ["labels", "issue-lifecycle"],
  });
});

test("registration CLI entry point runs from a path containing spaces", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "template cli path with spaces-"));
  try {
    const copiedScripts = join(temporaryRoot, "scripts");
    mkdirSync(copiedScripts);
    const script = join(copiedScripts, "register-with-playbook.mjs");
    cpSync(fileURLToPath(new URL("./register-with-playbook.mjs", import.meta.url)), script);
    mkdirSync(join(temporaryRoot, "node_modules"));
    cpSync(fileURLToPath(new URL("../node_modules/yaml", import.meta.url)), join(temporaryRoot, "node_modules/yaml"), { recursive: true });
    assert.match(script, / /);
    const result = spawnSync(process.execPath, [script, "--repo", "Plimmerton-Labs/example", "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, PLIMMERTON_AI_AGENT_TOKEN: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Set PLIMMERTON_AI_AGENT_TOKEN/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
