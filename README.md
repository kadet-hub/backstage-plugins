# kadet-hub Backstage plugins

Backstage plugins for [kadet-hub](https://kadet-hub.org), the catalog of
signed Kapitan generators and recipes.

- [`@kadet-hub/backstage-plugin-scaffolder-backend-module-kadet-hub`](plugins/scaffolder-backend-module-kadet-hub):
  the scaffolder action `kadet-hub:recipe:add` and the template
  [`templates/recipe/template.yaml`](templates/recipe/template.yaml). It adds
  a recipe to a Kapitan repository as a pull request, pinned by digest from
  the attested index.

Specs live in [`docs/specs/`](docs/specs/README.md). A change starts by
editing the spec it touches, in the same pull request.

## Development

Node 22 or 24, yarn through corepack:

```sh
corepack enable
yarn install
yarn tsc
yarn lint
yarn test
yarn prettier:check
```

The tests read the live kadet-hub index from GitHub and the Sigstore trust
root, so they need network access.
