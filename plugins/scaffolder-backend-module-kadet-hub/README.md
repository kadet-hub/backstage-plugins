# @kadet-hub/backstage-plugin-scaffolder-backend-module-kadet-hub

A scaffolder module for Backstage with one action, `kadet-hub:recipe:add`. It
adds a [kadet-hub recipe](https://kadet-hub.org/recipes/) to a Kapitan
repository: a fetch target that pins the recipe and the recipes it includes by
digest, and a target that includes the recipe. Version and digest come from
the kadet-hub index after its Sigstore attestation was verified, the same
check `gh attestation verify` runs in the
[consumer documentation](https://github.com/kadet-hub/registry/blob/main/docs/consumers.md).

The package is not published to npm yet.

## Install

```sh
yarn --cwd packages/backend add @kadet-hub/backstage-plugin-scaffolder-backend-module-kadet-hub
```

```ts
// packages/backend/src/index.ts
backend.add(
  import('@kadet-hub/backstage-plugin-scaffolder-backend-module-kadet-hub'),
);
```

The backend needs outbound HTTPS to `github.com`, where the index is a
release asset of kadet-hub/registry, and to the Sigstore TUF repository,
whose trust root sigstore-js caches in `$XDG_DATA_HOME/sigstore-js`.

Register the template
[`templates/recipe/template.yaml`](../../templates/recipe/template.yaml) in
the catalog by its URL. It asks for recipe, target name and repository, runs
the action and opens a pull request with `publish:github:pull-request`.

## Action

```yaml
- id: recipe
  action: kadet-hub:recipe:add
  input:
    recipe: immich # a recipe name from kadet-hub.org/recipes
    target: photos # the Kapitan target to create
    version: 1.0.0 # optional, default: newest version not yanked
    minSerial: 113 # optional, lowest index serial accepted
```

It writes `fetch/targets/<recipe>.yml`, `fetch/classes/.gitkeep` and
`inventory/targets/<target>.yml`, and refuses to overwrite any of them. Its
outputs are `serial`, `version`, `digest` and `policy`, the lines
`.kapitan-sandbox.yaml` needs for the new target. The action does not change
that file.

The target does not yet set the parameters a recipe requires, such as
`applications.valkey.password` for immich, because the index does not list
them. Add them before compiling; the recipe's README names them. The recipes
are tested on the omegaconf inventory backend.

Requirements and open questions are in
[`docs/specs/scaffolder.md`](../../docs/specs/scaffolder.md).
