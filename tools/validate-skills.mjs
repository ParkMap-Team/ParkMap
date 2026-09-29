import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseDocument } from 'yaml';

// Repository discovery budget, not an OpenAI platform limit.
const DESCRIPTION_WARNING_LENGTH = 200;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_INTERFACE_FIELDS = ['display_name', 'short_description', 'default_prompt'];
const OPTIONAL_INTERFACE_FIELDS = ['icon_small', 'icon_large', 'brand_color'];
const ALLOWED_TOP_LEVEL_METADATA_FIELDS = ['interface', 'dependencies', 'policy'];

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);

  if (!match) {
    return { error: 'SKILL.md must contain YAML frontmatter and a body' };
  }

  const entries = match[1]
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':');
      return separator === -1
        ? [line, '']
        : [line.slice(0, separator), line.slice(separator + 1).trim()];
    });

  return { entries, body: match[2] };
}

function parseInterfaceMetadata(content) {
  const document = parseDocument(content, { strict: true, uniqueKeys: true });

  if (document.errors.length > 0) {
    return { error: document.errors[0].message };
  }

  const metadata = document.toJS();
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { error: 'metadata must be a mapping' };
  }

  const unknownTopLevelFields = Object.keys(metadata).filter(
    (field) => !ALLOWED_TOP_LEVEL_METADATA_FIELDS.includes(field),
  );
  if (unknownTopLevelFields.length > 0) {
    return { error: `unknown top-level field ${unknownTopLevelFields[0]}` };
  }

  const interfaceMetadata = metadata.interface;
  if (
    !interfaceMetadata ||
    typeof interfaceMetadata !== 'object' ||
    Array.isArray(interfaceMetadata)
  ) {
    return { error: 'interface must be a mapping' };
  }

  const allowedInterfaceFields = [...REQUIRED_INTERFACE_FIELDS, ...OPTIONAL_INTERFACE_FIELDS];
  const unknownInterfaceFields = Object.keys(interfaceMetadata).filter(
    (field) => !allowedInterfaceFields.includes(field),
  );
  if (unknownInterfaceFields.length > 0) {
    return { error: `unknown interface field ${unknownInterfaceFields[0]}` };
  }

  return { interfaceMetadata };
}

function localMarkdownReferences(content) {
  return [...content.matchAll(/\]\((?!https?:|#)([^)#]+\.md)(?:#[^)]+)?\)/g)].map(
    (match) => match[1],
  );
}

export async function validateSkills(repositoryRoot) {
  const skillsRoot = join(repositoryRoot, '.agents', 'skills');
  const catalogPath = join(repositoryRoot, 'docs', 'agents', 'skills.md');
  const issues = [];
  const warnings = [];

  if (!existsSync(skillsRoot)) {
    return { skillCount: 0, issues: ['Missing .agents/skills directory'], warnings };
  }

  const skillNames = (await readdir(skillsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const catalog = existsSync(catalogPath) ? await readFile(catalogPath, 'utf8') : '';
  const catalogSkillNames = new Set(
    [...catalog.matchAll(/`\$([a-z0-9]+(?:-[a-z0-9]+)*)`/g)].map((match) => match[1]),
  );

  if (!catalog) {
    issues.push('Missing docs/agents/skills.md catalog');
  }

  for (const folderName of skillNames) {
    const skillDirectory = join(skillsRoot, folderName);
    const skillPath = join(skillDirectory, 'SKILL.md');
    const metadataPath = join(skillDirectory, 'agents', 'openai.yaml');

    if (!existsSync(skillPath)) {
      issues.push(`${folderName}: missing SKILL.md`);
      continue;
    }

    const content = await readFile(skillPath, 'utf8');
    const parsed = parseFrontmatter(content);

    if (parsed.error) {
      issues.push(`${folderName}: ${parsed.error}`);
      continue;
    }

    const keys = parsed.entries.map(([key]) => key);
    const values = new Map(parsed.entries);

    if (keys.length !== 2 || !keys.includes('name') || !keys.includes('description')) {
      issues.push(`${folderName}: frontmatter must contain only name and description`);
    }

    const declaredName = values.get('name');
    const description = values.get('description');

    if (declaredName !== folderName) {
      issues.push(`${folderName}: frontmatter name must match folder name`);
    }

    if (!declaredName || declaredName.length > 64 || !SKILL_NAME_PATTERN.test(declaredName)) {
      issues.push(`${folderName}: invalid skill name`);
    }

    if (!description) {
      issues.push(`${folderName}: description is required`);
    } else if (description.length > DESCRIPTION_WARNING_LENGTH) {
      warnings.push(
        `${folderName}: description exceeds ${DESCRIPTION_WARNING_LENGTH} characters; shorten discovery text and move detail into the body`,
      );
    }

    if (!parsed.body.trim() || /\bTODO\b/.test(parsed.body)) {
      issues.push(`${folderName}: body is empty or contains TODO`);
    }

    for (const reference of localMarkdownReferences(content)) {
      if (!existsSync(resolve(skillDirectory, reference))) {
        issues.push(`${folderName}: missing reference ${reference}`);
      }
    }

    if (!existsSync(metadataPath)) {
      issues.push(`${folderName}: missing agents/openai.yaml`);
      continue;
    }

    const parsedMetadata = parseInterfaceMetadata(await readFile(metadataPath, 'utf8'));
    if (parsedMetadata.error) {
      issues.push(`${folderName}: invalid agents/openai.yaml: ${parsedMetadata.error}`);
      continue;
    }

    const metadata = parsedMetadata.interfaceMetadata;

    for (const field of REQUIRED_INTERFACE_FIELDS) {
      if (typeof metadata[field] !== 'string' || !metadata[field]) {
        issues.push(`${folderName}: missing interface.${field}`);
      }
    }

    const shortDescription = metadata.short_description;
    if (
      typeof shortDescription === 'string' &&
      (shortDescription.length < 25 || shortDescription.length > 64)
    ) {
      issues.push(`${folderName}: short_description must contain 25-64 characters`);
    }

    const defaultPrompt = metadata.default_prompt;
    if (typeof defaultPrompt === 'string' && !defaultPrompt.includes(`$${folderName}`)) {
      issues.push(`${folderName}: default_prompt must mention $${folderName}`);
    }

    if (catalog && !catalogSkillNames.has(folderName)) {
      issues.push(`${folderName}: missing from docs/agents/skills.md`);
    }
  }

  for (const catalogSkillName of catalogSkillNames) {
    if (!skillNames.includes(catalogSkillName)) {
      issues.push(`${catalogSkillName}: catalog entry has no .agents/skills directory`);
    }
  }

  return { skillCount: skillNames.length, issues, warnings };
}

async function main() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, '..');
  const result = await validateSkills(repositoryRoot);

  for (const warning of result.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (result.issues.length > 0) {
    for (const issue of result.issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${result.skillCount} repository skills.`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
