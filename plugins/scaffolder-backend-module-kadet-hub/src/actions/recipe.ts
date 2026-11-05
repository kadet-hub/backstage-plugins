import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveSafeChildPath } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { verify } from 'sigstore';

const RELEASES = 'https://github.com/kadet-hub/registry/releases';
// Same identity as `gh attestation verify --cert-identity` in docs/consumers.md (CON-2).
export const INDEX_IDENTITY =
  'https://github.com/kadet-hub/registry/.github/workflows/release.yml@refs/heads/main';
const ISSUER = 'https://token.actions.githubusercontent.com';
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

type Pin = { name: string; version: string; digest: string };
type RecipeRecord = {
  digest: string;
  yanked: string | null;
  includes: Pin[];
  output_capabilities: string[];
};
export type Index = {
  serial: number;
  recipes: Record<string, Record<string, RecipeRecord>>;
};

/** Checks the Sigstore bundle of index.json and returns the parsed index. */
export async function verifyIndex(
  index: Buffer,
  bundle: any,
  identity = INDEX_IDENTITY,
): Promise<Index> {
  await verify(bundle, {
    certificateIssuer: ISSUER,
    certificateIdentityURI: identity,
  });
  // verify() checks the signature over the DSSE envelope; the subject digest ties it to this file.
  const statement = JSON.parse(
    Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString(),
  );
  const sha256 = createHash('sha256').update(index).digest('hex');
  if (
    statement.predicateType !== 'https://slsa.dev/provenance/v1' ||
    !statement.subject?.some((s: any) => s.digest?.sha256 === sha256)
  ) {
    throw new Error(`index.json sha256:${sha256} is not the attested subject`);
  }
  return JSON.parse(index.toString());
}

/** Downloads index.json and its bundle from the newest `index-<serial>` release. */
export async function fetchVerifiedIndex(): Promise<Index> {
  const latest = await fetch(`${RELEASES}/latest`, { redirect: 'manual' });
  const tag = latest.headers.get('location')?.split('/').pop() ?? '';
  if (!/^index-\d+$/.test(tag)) {
    throw new Error(`latest registry release is not an index release: ${tag}`);
  }
  const [index, bundle] = await Promise.all(
    ['index.json', 'index.json.sigstore.json'].map(async file => {
      const res = await fetch(`${RELEASES}/download/${tag}/${file}`);
      if (!res.ok) throw new Error(`${tag}/${file}: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }),
  );
  return verifyIndex(index, JSON.parse(bundle.toString()));
}

const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map(v => v.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

function listed(index: Index, name: string, version: string) {
  const rec = index.recipes?.[name]?.[version];
  if (!rec)
    throw new Error(
      `recipe ${name} ${version} is not in index serial ${index.serial}`,
    );
  if (rec.yanked)
    throw new Error(`recipe ${name} ${version} is yanked: ${rec.yanked}`);
  if (!VERSION.test(version) || !DIGEST.test(rec.digest)) {
    throw new Error(
      `recipe ${name} ${version} has a malformed version or digest`,
    );
  }
  return rec;
}

/** Picks the requested or newest non-yanked version and checks its includes. */
export function pickRecipe(index: Index, name: string, version?: string) {
  const versions = Object.keys(index.recipes?.[name] ?? {});
  const chosen =
    version ??
    versions
      .filter(v => !index.recipes[name][v].yanked)
      .sort(newer)
      .pop();
  if (!chosen)
    throw new Error(
      `recipe ${name} has no listed version in index serial ${index.serial}`,
    );
  const rec = listed(index, name, chosen);
  for (const inc of rec.includes) {
    if (listed(index, inc.name, inc.version).digest !== inc.digest) {
      throw new Error(
        `include ${inc.name} ${inc.version} does not match the index`,
      );
    }
  }
  return { version: chosen, ...rec };
}

const pin = (p: Pin) => `      - type: oci
        source: ghcr.io/kadet-hub/recipes/${p.name}:${p.version}@${p.digest}
        output_path: inventory/classes/recipes/${p.name}
`;

export function createKadetHubRecipeAction() {
  return createTemplateAction({
    id: 'kadet-hub:recipe:add',
    description:
      'Adds a kadet-hub recipe to a Kapitan project: a target and a fetch inventory pinned by digest from the attested index.',
    supportsDryRun: true,
    schema: {
      input: {
        recipe: z =>
          z.string().regex(NAME).describe('Recipe name, e.g. immich'),
        target: z => z.string().regex(NAME).describe('Kapitan target name'),
        version: z =>
          z
            .string()
            .regex(VERSION)
            .optional()
            .describe('Default: newest version not yanked'),
        minSerial: z =>
          z.number().int().optional().describe('Lowest accepted index serial'),
      },
      output: {
        serial: z => z.number(),
        version: z => z.string(),
        digest: z => z.string(),
        policy: z => z.string(),
      },
    },
    async handler(ctx) {
      const { recipe, target, minSerial } = ctx.input;
      const index = await fetchVerifiedIndex();
      if (minSerial !== undefined && index.serial < minSerial) {
        throw new Error(
          `index serial ${index.serial} is lower than ${minSerial}`,
        );
      }
      const rec = pickRecipe(index, recipe, ctx.input.version);
      ctx.logger.info(
        `index serial ${index.serial} verified; ${recipe} ${rec.version} ${
          rec.digest
        }, includes: ${
          rec.includes.map(i => `${i.name} ${i.version}`).join(', ') || 'none'
        }`,
      );

      const files: Record<string, string> = {
        [`fetch/targets/${recipe}.yml`]: `# kadet-hub index serial ${
          index.serial
        }
parameters:
  kapitan:
    dependencies:
${[{ name: recipe, version: rec.version, digest: rec.digest }, ...rec.includes]
  .map(pin)
  .join('')}`,
        'fetch/classes/.gitkeep': '',
        [`inventory/targets/${target}.yml`]: `classes:
  - recipes.${recipe}
parameters:
  namespace: ${target}
  kapitan:
    vars:
      target: ${target}
`,
      };
      for (const [file, content] of Object.entries(files)) {
        const dest = resolveSafeChildPath(ctx.workspacePath, file);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        // 'wx' refuses to overwrite a target or fetch pin the workspace already holds.
        await fs.writeFile(dest, content, {
          flag: file.endsWith('.gitkeep') ? 'w' : 'wx',
        });
      }

      const caps = rec.output_capabilities;
      ctx.output('serial', index.serial);
      ctx.output('version', rec.version);
      ctx.output('digest', rec.digest);
      // shortcut: omegaconf is what the kadet-hub/recipes README tests; the index record does not carry it yet.
      ctx.output(
        'policy',
        `fetch_inventory: fetch\ninventory_backend: omegaconf\nindex_serial: ${
          index.serial
        }\n${
          caps.length
            ? `output_capabilities:\n  "compiled/${target}/*": [${caps.join(
                ', ',
              )}]\n`
            : ''
        }`,
      );
    },
  });
}
