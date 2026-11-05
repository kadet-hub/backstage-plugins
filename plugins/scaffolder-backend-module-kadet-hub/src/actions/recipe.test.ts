import fs from 'node:fs';
import path from 'node:path';
import { createMockDirectory } from '@backstage/backend-test-utils';
import { createMockActionContext } from '@backstage/plugin-scaffolder-node-test-utils';
import {
  createKadetHubRecipeAction,
  Index,
  INDEX_IDENTITY,
  pickRecipe,
  verifyIndex,
} from './recipe';

jest.setTimeout(60_000);

// Immutable release, so the bytes and the bundle stay fixed.
const asset = async (file: string) => {
  const res = await fetch(
    `https://github.com/kadet-hub/registry/releases/download/index-113/${file}`,
  );
  return Buffer.from(await res.arrayBuffer());
};

describe('verifyIndex (live, index-113)', () => {
  let index: Buffer;
  let bundle: any;
  beforeAll(async () => {
    index = await asset('index.json');
    bundle = JSON.parse((await asset('index.json.sigstore.json')).toString());
  });

  it('accepts the attested index', async () => {
    expect((await verifyIndex(index, bundle)).serial).toBe(113);
  });

  it('rejects an index.json changed by one byte', async () => {
    await expect(
      verifyIndex(Buffer.concat([index, Buffer.from(' ')]), bundle),
    ).rejects.toThrow('is not the attested subject');
  });

  it('rejects a signer identity other than release.yml on main', async () => {
    await expect(
      verifyIndex(
        index,
        bundle,
        INDEX_IDENTITY.replace('refs/heads/main', 'refs/heads/dev'),
      ),
    ).rejects.toThrow('certificate identity error');
  });
});

describe('pickRecipe', () => {
  const d = (n: number) => `sha256:${String(n).repeat(64)}`;
  const rec = (digest: string, extra = {}) => ({
    digest,
    yanked: null,
    includes: [],
    output_capabilities: [],
    ...extra,
  });
  const index: Index = {
    serial: 7,
    recipes: {
      app: {
        '1.9.0': rec(d(1)),
        '1.10.0': rec(d(2), {
          includes: [{ name: 'db', version: '1.0.0', digest: d(3) }],
        }),
        '2.0.0': rec(d(4), { yanked: 'CVE' }),
      },
      db: { '1.0.0': rec(d(3)) },
    },
  };

  it('picks the newest version not yanked', () => {
    expect(pickRecipe(index, 'app').version).toBe('1.10.0');
  });
  it('refuses a yanked version', () => {
    expect(() => pickRecipe(index, 'app', '2.0.0')).toThrow('yanked: CVE');
  });
  it('refuses an unknown recipe', () => {
    expect(() => pickRecipe(index, 'nope')).toThrow('no listed version');
  });
  it('refuses an include whose digest the index does not list', () => {
    const bad = structuredClone(index);
    bad.recipes.db['1.0.0'].digest = d(5);
    expect(() => pickRecipe(bad, 'app')).toThrow('include db 1.0.0');
  });
});

describe('kadet-hub:recipe:add (live, latest index)', () => {
  const dir = createMockDirectory();
  const action = createKadetHubRecipeAction();
  const run = (input: any) =>
    action.handler(createMockActionContext({ input, workspacePath: dir.path }));

  it('writes the target and a fetch inventory pinned by digest', async () => {
    const ctx = createMockActionContext({
      input: { recipe: 'immich', target: 'photos' },
      workspacePath: dir.path,
    });
    await action.handler(ctx);
    const fetchTarget = fs.readFileSync(
      path.join(dir.path, 'fetch/targets/immich.yml'),
      'utf8',
    );
    const out = Object.fromEntries((ctx.output as jest.Mock).mock.calls);
    expect(fetchTarget).toContain(
      `ghcr.io/kadet-hub/recipes/immich:${out.version}@${out.digest}`,
    );
    expect(fetchTarget).toContain(
      'output_path: inventory/classes/recipes/postgresql',
    );
    expect(
      fs.readFileSync(
        path.join(dir.path, 'inventory/targets/photos.yml'),
        'utf8',
      ),
    ).toContain('- recipes.immich');
    // a second run must not overwrite what is there
    await expect(run({ recipe: 'immich', target: 'photos' })).rejects.toThrow(
      'EEXIST',
    );
  });

  it('refuses an index older than minSerial', async () => {
    await expect(
      run({ recipe: 'immich', target: 'x', minSerial: 10 ** 9 }),
    ).rejects.toThrow('is lower than');
  });
});
