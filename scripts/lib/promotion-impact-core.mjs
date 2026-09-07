// Pure decision logic for develop -> main promotion PR impact classification.
// The promotion workflow runs from main and fetches GitHub's compare response; this
// module keeps the "activation review required vs lightweight approval path" decision
// unit-testable instead of burying it in inline workflow shell.

const ACTIVATION_REVIEW_PATTERNS = [
  /^\.github\/workflows\//,
  /^\.github\/actions\//,
  /^scripts\//,
  /^package\.json$/,
  /^package-lock\.json$/,
];

function filePath(file) {
  return typeof file === "string" ? file : file?.filename;
}

function compareFiles(compareOrFiles) {
  if (Array.isArray(compareOrFiles)) return compareOrFiles;
  if (Array.isArray(compareOrFiles?.files)) return compareOrFiles.files;
  throw new TypeError("GitHub compare response must include a files array");
}

export function activationReviewPaths(compareOrFiles) {
  const files = compareFiles(compareOrFiles);

  return files.map(filePath).filter((path) => typeof path === "string" && ACTIVATION_REVIEW_PATTERNS.some((pattern) => pattern.test(path)));
}

export function classifyPromotionImpact(compareOrFiles) {
  const activationPaths = activationReviewPaths(compareOrFiles);
  return {
    mode: activationPaths.length > 0 ? "activation-review" : "lightweight-approval",
    activationPaths,
  };
}

function bulletList(paths) {
  return paths.map((path) => `- \`${path}\``).join("\n");
}

export function renderPromotionImpactSection(compareOrFiles) {
  const impact = classifyPromotionImpact(compareOrFiles);

  if (impact.mode === "activation-review") {
    return [
      "**Promotion impact: activation review required.**",
      "",
      "This promotion includes workflow/action/script/package changes. Default-branch-sourced automation, including `pull_request_target` and `schedule` workflows, runs from `main`, so this PR is also the activation step for that automation. Do not rely on the new automation behaviour until this PR merges.",
      "",
      "Changed activation paths:",
      "",
      bulletList(impact.activationPaths),
      "",
      "Before approving, confirm the already-reviewed change is still understood as an activation, checks are green, and prompt promotion is appropriate.",
    ].join("\n");
  }

  return [
    "**Promotion impact: lightweight approval path.**",
    "",
    "No workflow/action/script/package changes were detected by the conservative path check. Treat this as a promotion approval, not a duplicate code review: confirm checks are green, the develop batch is understandable, and the merge method is correct.",
  ].join("\n");
}

export function renderPromotionPrBody(compareOrFiles) {
  return [
    "Automated promotion PR after changes were merged to `develop`.",
    "",
    "Human review is still required before merge. This review is a promotion/activation approval, not a second review of already-approved feature PRs. In CI/CD terms, keep the integration-to-main cycle short: once checks are green and the promotion impact is understood, prefer prompt review and merge over batching unrelated develop changes.",
    "",
    renderPromotionImpactSection(compareOrFiles),
    "",
    '**Merge method: use "Create a merge commit."** Do not squash this PR -- squashing discards the develop branch history as an ancestor of main, which causes the next promotion to show spurious conflicts unrelated to real content changes (see engineering-playbook#37). The repository ruleset for main should already restrict merges to "merge commit" only; this note is a second line of defence in case that ruleset is ever loosened.',
  ].join("\n");
}
