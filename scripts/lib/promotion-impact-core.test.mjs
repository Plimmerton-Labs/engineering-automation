import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activationReviewPaths,
  classifyPromotionImpact,
  renderPromotionImpactSection,
  renderPromotionPrBody,
} from "./promotion-impact-core.mjs";

test("activationReviewPaths matches workflow, action, script, and package paths from a compare response", () => {
  const compare = {
    files: [
      { filename: ".github/workflows/promote-develop-to-main.yml" },
      { filename: ".github/actions/preflight-verify/action.yml" },
      { filename: "scripts/render-promotion-pr-body.mjs" },
      { filename: "package.json" },
      { filename: "package-lock.json" },
      { filename: "README.md" },
      { filename: "docs/decisions/0003-issue-lifecycle-sync-design.md" },
    ],
  };

  assert.deepEqual(activationReviewPaths(compare), [
    ".github/workflows/promote-develop-to-main.yml",
    ".github/actions/preflight-verify/action.yml",
    "scripts/render-promotion-pr-body.mjs",
    "package.json",
    "package-lock.json",
  ]);
});

test("activationReviewPaths also accepts a plain file path array", () => {
  assert.deepEqual(activationReviewPaths(["OPERATING_MODEL.md", "scripts/github-app-token.mjs"]), [
    "scripts/github-app-token.mjs",
  ]);
});

test("classifyPromotionImpact returns lightweight approval when no activation paths are present", () => {
  assert.deepEqual(classifyPromotionImpact({ files: [{ filename: "README.md" }, { filename: "docs/guide.md" }] }), {
    mode: "lightweight-approval",
    activationPaths: [],
  });
});

test("classifyPromotionImpact returns lightweight approval for an empty compare files array", () => {
  assert.deepEqual(classifyPromotionImpact({ files: [] }), {
    mode: "lightweight-approval",
    activationPaths: [],
  });
});

test("classifyPromotionImpact fails loudly when the compare response is malformed", () => {
  assert.throws(() => classifyPromotionImpact({}), /files array/);
});

test("renderPromotionImpactSection lists activation paths for activation review", () => {
  const section = renderPromotionImpactSection({
    files: [{ filename: ".github/workflows/test.yml" }, { filename: "README.md" }],
  });

  assert.match(section, /activation review required/);
  assert.match(section, /- `\.github\/workflows\/test\.yml`/);
  assert.doesNotMatch(section, /README\.md/);
});

test("renderPromotionImpactSection describes lightweight approval when no activation paths match", () => {
  const section = renderPromotionImpactSection({ files: [{ filename: "README.md" }] });

  assert.match(section, /lightweight approval path/);
  assert.match(section, /not a duplicate code review/);
});

test("renderPromotionPrBody includes the promotion approval purpose and merge method", () => {
  const body = renderPromotionPrBody({ files: [{ filename: "README.md" }] });

  assert.match(body, /promotion\/activation approval/);
  assert.match(body, /Create a merge commit/);
  assert.match(body, /lightweight approval path/);
});
