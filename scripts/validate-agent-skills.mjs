import fs from 'node:fs'
import path from 'node:path'

const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd()
const agentsDir = path.join(rootDir, 'agents')

function fail(message) {
  console.error(`[agents] ${message}`)
  process.exitCode = 1
}

function parseSimpleYamlMap(text) {
  const lines = text.split(/\r?\n/)
  const out = {}
  let section = null
  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ')
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0
    const match = line.trim().match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    if (indent === 0) {
      section = rawValue ? null : key
      if (rawValue) out[key] = rawValue.replace(/^"(.*)"$/, '$1')
      else out[key] = {}
      continue
    }
    if (indent >= 2 && section) {
      out[section][key] = rawValue.replace(/^"(.*)"$/, '$1')
    }
  }
  return out
}

function validateSkillDir(skillDir) {
  const skillPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(skillPath)) {
    fail(`${path.relative(rootDir, skillDir)} is missing SKILL.md`)
    return
  }

  const content = fs.readFileSync(skillPath, 'utf8')
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!frontmatterMatch) {
    fail(`${path.relative(rootDir, skillPath)} has invalid frontmatter`)
    return
  }

  const frontmatter = parseSimpleYamlMap(frontmatterMatch[1])
  const name = String(frontmatter.name || '').trim()
  const description = String(frontmatter.description || '').trim()
  if (!/^[a-z0-9-]{1,64}$/.test(name)) {
    fail(`${path.relative(rootDir, skillPath)} has invalid skill name: ${name || '<empty>'}`)
  }
  if (!description) {
    fail(`${path.relative(rootDir, skillPath)} is missing description`)
  }

  const openaiPath = path.join(skillDir, 'agents', 'openai.yaml')
  if (!fs.existsSync(openaiPath)) {
    fail(`${path.relative(rootDir, skillDir)} is missing agents/openai.yaml`)
    return
  }

  const openai = parseSimpleYamlMap(fs.readFileSync(openaiPath, 'utf8'))
  const iface = openai.interface || {}
  const displayName = String(iface.display_name || '').trim()
  const shortDescription = String(iface.short_description || '').trim()
  const defaultPrompt = String(iface.default_prompt || '').trim()

  if (!displayName) {
    fail(`${path.relative(rootDir, openaiPath)} is missing interface.display_name`)
  }
  if (shortDescription.length < 25 || shortDescription.length > 64) {
    fail(`${path.relative(rootDir, openaiPath)} has invalid short_description length (${shortDescription.length})`)
  }
  if (!defaultPrompt.includes(`$${name}`)) {
    fail(`${path.relative(rootDir, openaiPath)} default_prompt must mention $${name}`)
  }
}

if (!fs.existsSync(agentsDir)) {
  fail(`agents directory not found at ${agentsDir}`)
  process.exit(process.exitCode ?? 1)
}

const skillDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(agentsDir, entry.name))

for (const skillDir of skillDirs) {
  validateSkillDir(skillDir)
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode)
}

console.log(`[agents] validated ${skillDirs.length} skill directories in ${rootDir}`)
