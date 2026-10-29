# ci-workflows

cordis-tavern 组织共用的 GitHub Actions 工作流。**必须保持 public**：私有仓库无法被其他仓库引用。

当前只有一个工作流：[`publish-npm.yml`](.github/workflows/publish-npm.yml) —— 用 npm **OIDC Trusted Publishing**（无令牌）把包发到 npm，按 tag 自动决定 dist-tag。

```
业务仓库 push tag v1.2.3
        │
        ▼
业务仓库 .github/workflows/publish.yml        ← 只做一件事：调用
        │  uses: cordis-tavern/ci-workflows/.github/workflows/publish-npm.yml@main
        ▼
ci-workflows .github/workflows/publish-npm.yml  ← 真正执行 npm publish 的地方
        │  OIDC → npm 换取短期 token
        ▼
npm registry（dist-tag: latest / rc / alpha / beta / next）
```

## 一、发布规则

| 场景 | Git tag | `package.json` `version` | npm dist-tag |
| --- | --- | --- | --- |
| 正式版 | `v1.2.3` | `1.2.3` | `latest` |
| RC 版 | `v1.2.3-rc.1` | `1.2.3-rc.1` | `rc` |
| Beta | `v1.2.3-beta.1` | `1.2.3-beta.1` | `beta` |
| Alpha | `v1.2.3-alpha.1` | `1.2.3-alpha.1` | `alpha` |
| 其它预发布 | `v1.2.3-next.1` | `1.2.3-next.1` | `next` |

约束（工作流会硬校验，不合规直接失败）：

- 只接受 **tag 触发**，`v` 前缀必需；
- tag 去掉 `v` 之后必须**逐字等于** `package.json` 的 `version`；
- `package.json` 不能是 `private: true`；
- scoped 包一律 `--access public`；
- 该版本已存在于 registry 时**跳过并成功**（tag 重推 / 重跑不会变红）。

## 二、一次性配置

### 1. 让仓库能看到本仓库

`ci-workflows` 是 public，私有业务仓库可直接调用，无需额外授权。

### 2. 给每个 npm 包配置 Trusted Publisher

> ⚠️ **最容易错的一步。** OIDC 令牌标识的是**真正执行 `npm publish` 的工作流**（`job_workflow_ref`），也就是本仓库的 `publish-npm.yml`，**不是**业务仓库里那个只负责调用的 `publish.yml`。填错了 npm 只会给 `404` / `ENEEDAUTH`，不会告诉你哪里错。

每个包在 npmjs.com → *Package settings → Trusted publishing* 填：

| 字段 | 值 |
| --- | --- |
| Publisher | GitHub Actions |
| Organization or user | `cordis-tavern` |
| Repository | `ci-workflows` |
| Workflow filename | `publish-npm.yml` |
| Environment name | **留空** |
| Allowed actions | 勾选 **npm publish** |

批量配置（推荐，省掉 16 次手点）：

```bash
npm login                       # 必须走网页登录；带 2FA-bypass 的 token 调用该接口会 403
node scripts/setup-trust.mjs    # 按 packages.json 逐个执行 npm trust github
node scripts/setup-trust.mjs --dry-run   # 先看要发哪些请求
```

`scripts/setup-trust.mjs` 的等价命令：

```bash
npm trust github @cordis-tavern/ct-host-web \
  --repo cordis-tavern/ci-workflows \
  --file publish-npm.yml \
  --allow-publish -y
```

**尚未发布过的包**（当前是 `@cordis-tavern/ct-ui-kit`）无法配置 Trusted Publisher —— npm 的信任配置挂在已存在的包上。先手工 `npm publish --access public` 一次，再补配置，之后全部交给 CI。

### 3. 业务仓库加调用方工作流

复制 [`examples/publish.yml`](examples/publish.yml) 到业务仓库的 `.github/workflows/publish.yml`。

`permissions` 是硬要求：**调用方必须给 `id-token: write`**，否则 OIDC 拿不到令牌，报错看起来像"忘了配 NPM_TOKEN"。

## 三、日常发版

```bash
# 1. 改版本（手工，或 npm version 不带 git-tag）
npm version 1.2.4 --no-git-tag-version
git commit -am "release: 1.2.4"
git push

# 2. 打 tag 并推送 —— 这一步才触发发布
git tag v1.2.4
git push origin v1.2.4
```

RC：`git tag v1.2.4-rc.1 && git push origin v1.2.4-rc.1` → 发到 `rc` 通道，`latest` 不动。

安装侧：

```bash
npm i @cordis-tavern/xxx          # latest
npm i @cordis-tavern/xxx@rc       # 最新 rc
```

## 四、可调输入

业务仓库可以在 `with:` 里覆盖（全部可选）：

| 输入 | 默认 | 说明 |
| --- | --- | --- |
| `package-dir` | `.` | 包目录；单包仓库不用填 |
| `node-version` | `24` | 必须 ≥ 22.14.0 |
| `npm-version` | `^11.5.1` | 工作流会 `npm i -g` 显式升级 |
| `pnpm-version` | 读 `packageManager` | 无该字段时才需要填 |
| `install-command` | `pnpm install --frozen-lockfile` | 置空跳过（无依赖包） |
| `build-command` | `pnpm build` | 置空跳过（纯 JS 包） |
| `test-command` | 空 | 建议逐步打开 |
| `dist-tag` | 自动 | 覆盖推导结果 |
| `access` | `public` | scoped 包别改 |
| `provenance` | `auto` | 见下节 |
| `dry-run` | `false` | 只打包不发布 |

## 五、私有仓库与 provenance

npm 的 provenance（构建来源证明）**只支持公开源码仓库**，这是 GitHub 在 2023-07 起就生效的限制（见 [changelog](https://github.blog/changelog/2023-07-26-publishing-with-npm-provenance-from-private-source-repositories-is-no-longer-supported/)）。

所以：

- 本组织仓库目前是 **private** → `provenance: auto`（默认）下 npm 不会生成 provenance（npm 会读取 OIDC 令牌里的 `repository_visibility`，非 public 就跳过），发布正常；
- 仓库将来转 public 后，同一条工作流会**自动开始生成 provenance**，不需要改配置；
- 想强制关闭 / 开启，用 `provenance: false` / `provenance: true`。

## 六、排障：`404` 与 `ENEEDAUTH`

npm 对这六种原因给的是同一个错误，按顺序排查：

1. **Trusted Publisher 指错了工作流** —— 必须指向本仓库的 `publish-npm.yml`，不是调用方；
2. **调用方没给 `id-token: write`** —— 没有 OIDC 令牌，npm 退化成 token 认证；
3. **`NODE_AUTH_TOKEN` / `NPM_TOKEN` 被设成了空字符串** —— 空值也算"设了"，工作流已显式 `unset`；
4. **`.npmrc` 里有 `_authToken=${NODE_AUTH_TOKEN}`** —— `setup-node` 的 `registry-url` 会写这一行，工作流已删除；
5. **npm < 11.5.1 或 Node < 22.14.0** —— 工作流显式升级并校验；
6. **scoped 包没带 `--access public`** —— 首次发布会 404，工作流已固定带上。

另外两种常见情况：

- **同一个仓库里有两个会跑 `npm publish` 的工作流**：只有一个能匹配 Trusted Publisher 里填的文件名，另一个必然失败；
- **私有仓库**：不影响发布，只影响 provenance（见上节）。

## 七、本仓库自身的约定

- 改 `publish-npm.yml` 会在**所有仓库的下一次发版**生效（调用方用 `@main`）；要稳妥可把调用方钉到 commit SHA，那就得逐仓升级；
- 不要在业务仓库里复制发布逻辑 —— 复制一份就有第二个"执行者"，Trusted Publisher 只能指一个。
