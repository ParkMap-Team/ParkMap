import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { validateSkills } from './validate-skills.mjs';

async function createRepository(defaultPrompt = 'Use $sample-skill now.') {
  const root = await mkdtemp(join(tmpdir(), 'parkmap-skill-test-'));
  const skillDirectory = join(root, '.agents', 'skills', 'sample-skill');

  await mkdir(join(skillDirectory, 'agents'), { recursive: true });
  await mkdir(join(root, 'docs', 'agents'), { recursive: true });
  await writeFile(
    join(skillDirectory, 'SKILL.md'),
    `---\nname: sample-skill\ndescription: Use this sample skill when validating the harness.\n---\n\n# Sample\n\nFollow the workflow.\n`,
  );
  await writeFile(
    join(skillDirectory, 'agents', 'openai.yaml'),
    `interface:\n  display_name: 'Sample Skill'\n  short_description: 'Validate a repository skill fixture'\n  default_prompt: '${defaultPrompt}'\n`,
  );
  await writeFile(join(root, 'docs', 'agents', 'skills.md'), '# Skills\n\nUse `$sample-skill`.\n');

  return root;
}

test('accepts a complete repository skill', async (context) => {
  const root = await createRepository();
  context.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateSkills(root);

  assert.equal(result.skillCount, 1);
  assert.deepEqual(result.issues, []);
});

test('rejects metadata that cannot invoke its skill', async (context) => {
  const root = await createRepository('Use this skill now.');
  context.after(() => rm(root, { recursive: true, force: true }));

  const result = await validateSkills(root);

  assert.deepEqual(result.issues, ['sample-skill: default_prompt must mention $sample-skill']);
});

test('rejects a catalog entry without a skill directory', async (context) => {
  const root = await createRepository();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'docs', 'agents', 'skills.md'),
    '# Skills\n\nUse `$sample-skill` and `$missing-skill`.\n',
  );

  const result = await validateSkills(root);

  assert.ok(result.issues.includes('missing-skill: catalog entry has no .agents/skills directory'));
});

test('rejects a non-string default prompt without crashing', async (context) => {
  const root = await createRepository();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, '.agents', 'skills', 'sample-skill', 'agents', 'openai.yaml'),
    `interface:\n  display_name: 'Sample Skill'\n  short_description: 'Validate a repository skill fixture'\n  default_prompt: true\n`,
  );

  const result = await validateSkills(root);

  assert.deepEqual(result.issues, ['sample-skill: missing interface.default_prompt']);
});

const invalidMetadataCases = [
  [
    'malformed YAML',
    `interface:\n  display_name: 'Sample Skill'\n  short_description: 'Validate a repository skill fixture'\n  default_prompt: 'Use $sample-skill now.'\nbroken: [\n`,
  ],
  [
    'duplicate keys',
    `interface:\n  display_name: 'Sample Skill'\n  display_name: 'Duplicate'\n  short_description: 'Validate a repository skill fixture'\n  default_prompt: 'Use $sample-skill now.'\n`,
  ],
  [
    'unknown top-level fields',
    `interface:\n  display_name: 'Sample Skill'\n  short_description: 'Validate a repository skill fixture'\n  default_prompt: 'Use $sample-skill now.'\nunexpected: true\n`,
  ],
  [
    'unknown interface fields',
    `interface:\n  display_name: 'Sample Skill'\n  short_description: 'Validate a repository skill fixture'\n  default_prompt: 'Use $sample-skill now.'\n  unexpected: true\n`,
  ],
];

for (const [caseName, metadata] of invalidMetadataCases) {
  test(`rejects ${caseName}`, async (context) => {
    const root = await createRepository();
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(
      join(root, '.agents', 'skills', 'sample-skill', 'agents', 'openai.yaml'),
      metadata,
    );

    const result = await validateSkills(root);

    assert.ok(
      result.issues.some((issue) => issue.startsWith('sample-skill: invalid agents/openai.yaml:')),
    );
  });
}

for (const [length, expectedWarnings] of [
  [200, 0],
  [201, 1],
]) {
  test(`reports description budget warnings at ${length} characters`, async (context) => {
    const root = await createRepository();
    context.after(() => rm(root, { recursive: true, force: true }));
    await writeFile(
      join(root, '.agents', 'skills', 'sample-skill', 'SKILL.md'),
      `---\nname: sample-skill\ndescription: ${'x'.repeat(length)}\n---\n\n# Sample\n\nValid body.\n`,
    );
    const result = await validateSkills(root);
    assert.deepEqual(result.issues, []);
    assert.equal(result.warnings.length, expectedWarnings);
    if (expectedWarnings) assert.match(result.warnings[0], /sample-skill.*description.*200/);
  });
}

test('returns diagnostics when the skills directory is missing', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'parkmap-skill-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const result = await validateSkills(root);
  assert.equal(result.skillCount, 0);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.issues, ['Missing .agents/skills directory']);
});

test('rejects a missing workflow reference', async (context) => {
  const root = await createRepository();
  context.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, '.agents', 'skills', 'sample-skill', 'SKILL.md'),
    '---\nname: sample-skill\ndescription: Route a sample task.\n---\n\nRead [workflow](references/missing.md).\n',
  );
  const result = await validateSkills(root);
  assert.deepEqual(result.issues, ['sample-skill: missing reference references/missing.md']);
});
