import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { planLabelSync, validateLabels } from "./sync-labels.mjs";

const desired = [
  {
    name: "stage:triage",
    color: "fbca04",
    description: "New work item awaiting assessment, dedupe, and clarification.",
  },
  {
    name: "agent:blocked",
    color: "b60205",
    description: "Agent cannot proceed; human input required before further work.",
  },
];

describe("validateLabels", () => {
  it("rejects duplicate names", () => {
    assert.throws(
      () => validateLabels([desired[0], desired[0]]),
      /Duplicate label/,
    );
  });

  it("rejects invalid colours", () => {
    assert.throws(
      () =>
        validateLabels([
          {
            name: "bad",
            color: "blue",
            description: "Invalid colour value.",
          },
        ]),
      /invalid color/,
    );
  });
});

describe("planLabelSync", () => {
  it("creates missing labels", () => {
    const plan = planLabelSync(desired, []);
    assert.deepEqual(
      plan.map((item) => [item.action, item.desired.name]),
      [
        ["create", "stage:triage"],
        ["create", "agent:blocked"],
      ],
    );
  });

  it("updates labels when color or description drift", () => {
    const plan = planLabelSync(desired, [
      {
        name: "stage:triage",
        color: "000000",
        description: "Old description.",
      },
      desired[1],
    ]);

    assert.equal(plan[0].action, "update");
    assert.equal(plan[1].action, "noop");
  });

  it("leaves unrelated local labels alone", () => {
    const plan = planLabelSync([desired[0]], [
      desired[0],
      {
        name: "project-local",
        color: "ffffff",
        description: "Local project label.",
      },
    ]);

    assert.deepEqual(
      plan.map((item) => item.action),
      ["noop"],
    );
  });
});

it("label sync CLI entry point runs from a path containing spaces", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "template cli path with spaces-"));
  try {
    const script = join(temporaryRoot, "sync-labels.mjs");
    cpSync(fileURLToPath(new URL("./sync-labels.mjs", import.meta.url)), script);
    assert.match(script, / /);
    const result = spawnSync(process.execPath, [script, "--repo", "Plimmerton-Labs/example", "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, GH_TOKEN: "", GITHUB_TOKEN: "" },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Set GH_TOKEN or GITHUB_TOKEN/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
