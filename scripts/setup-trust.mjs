#!/usr/bin/env node
/**
 * 批量配置 npm Trusted Publisher（OIDC，无令牌）。
 *
 *   node scripts/setup-trust.mjs            # 按 packages.json 逐个配置
 *   node scripts/setup-trust.mjs --dry-run  # 只打印将要执行的命令
 *   node scripts/setup-trust.mjs --only @cordis-tavern/ct-host-web
 *
 * 等价于：
 *   npm trust github <pkg> --repo cordis-tavern/ci-workflows --file publish-npm.yml --allow-publish -y
 *
 * 前提：`npm login` 走网页登录。带 2FA-bypass 的 automation token 调用该接口会 403。
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const configUrl = new URL('../packages.json', import.meta.url)
const config = JSON.parse(readFileSync(configUrl, 'utf8'))
const args = process.argv.slice(2)

const dryRun = args.includes('--dry-run')
const onlyIndex = args.indexOf('--only')
const only = onlyIndex === -1 ? null : args[onlyIndex + 1]

const { repository, file } = config.workflow
if (!repository || !file) {
  console.error('packages.json 缺少 workflow.repository / workflow.file')
  process.exit(1)
}

const targets = config.packages.filter((p) => (only ? p.name === only : true))
if (targets.length === 0) {
  console.error(`没有匹配的包：${only ?? '<全部为空>'}`)
  process.exit(1)
}

console.log(`工作流：${repository} / ${file}`)
console.log(`目标：${targets.length} 个包${dryRun ? '（dry-run，不写配置）' : ''}\n`)

const failed = []
for (const pkg of targets) {
  if (pkg.published === false) {
    console.log(`⏭  ${pkg.name} 尚未发布过，npm 无法为不存在的包配置 Trusted Publisher —— 先手工发一次`)
    failed.push({ name: pkg.name, reason: 'not published yet' })
    continue
  }
  const cmd = [
    'trust', 'github', pkg.name,
    '--repo', repository,
    '--file', file,
    '--allow-publish',
    '-y',
  ]
  if (dryRun) cmd.push('--dry-run')

  console.log(`▶ ${pkg.name}`)
  const res = spawnSync('npm', cmd, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (res.status !== 0) failed.push({ name: pkg.name, reason: `npm exit ${res.status}` })
}

console.log('\n──────── 结果 ────────')
for (const pkg of targets) {
  const bad = failed.find((f) => f.name === pkg.name)
  console.log(`${bad ? '✗' : '✓'} ${pkg.name}${bad ? `  (${bad.reason})` : ''}`)
}
if (failed.length > 0) {
  console.log(`\n${failed.length} 个未配置成功。常见原因：未登录 / 2FA token / 包未发布 / 无包维护权限`)
  process.exit(1)
}
console.log('\n全部配置完成。发 tag 即可触发 CI 发布。')
