# Specs

One living spec per area in `docs/specs/<area>.md`. A change to code,
configuration or CI starts by editing the spec it touches, in the same pull
request, as its first commit. The conventions follow
[kadet-hub/registry](https://github.com/kadet-hub/registry/blob/main/docs/specs/README.md).

Header of every spec:

```
Status: Draft | Approved | As-built | Superseded by <file>
Code: <paths this spec governs>
Verified against: main @ <commit>
```

The body opens with the problem and the decisions, closes with open
questions and the implementation inventory, and is organised by technical
subject in between. Requirements carry an area prefix (`BS-3`), are never
renumbered or reused, and name their check and origin:

```markdown
- BS-3: The action MUST fail on a yanked version.

  - Test: <test name, CI job or `manual:` runbook step> | none
  - Since: <pull request or commit> | this change | not implemented
```

Decisions are `DEC-n`, open questions `OQ-n`, acceptance criteria `AC-n`;
every acceptance criterion names the requirements it checks.

| Spec                           | Area                                                      | Prefix |
| ------------------------------ | --------------------------------------------------------- | ------ |
| [scaffolder.md](scaffolder.md) | scaffolder action `kadet-hub:recipe:add` and its template | BS     |
