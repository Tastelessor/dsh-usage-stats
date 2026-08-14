# dsh-usage-stats

dsh（DeepSeek Harness）外部插件：在 Web 设置面板新增「用量统计」页，展示过去 7/15/30 天的
token 用量与估算金额折线图，以及当前已接入模型的 M tokens 单价表（输入命中缓存 / 输入未命中缓存 / 输出）。

## 功能

- 设置 → 用量统计：时间范围切换（7/15/30 天）、token 用量折线图（总量 / 输入 / 输出 / 缓存 / 推理）、金额折线图、汇总卡片。
- 模型单价表：展示当前已接入模型（来自 `ctx.llm` 模型目录）的单价；默认内置 `deepseek-v4-flash` 与 `deepseek-v4-pro` 价格。
- 数据来源：历史会话日志中 `assistant/message` 事件携带的 `usage`（纯观察者，不改动 agent-loop）。
- 计价默认货币 CNY（¥），可配置 USD（$）。

## 界面截图

> 占位（TODO-screenshots）：安装后在「设置 → 用量统计」页手动截图，替换下方图片链接后删除本行。

- 用量统计页（图表 + 汇总 + 单价表）：`docs/screenshots/usage-stats.png`
- 空态：`docs/screenshots/usage-stats-empty.png`

## 安装

npm 渠道（预构建，零权限）：

```sh
dsh plugin --profile demo add dsh-usage-stats
```

GitHub 直装（源码 + prepare 自构建，需放行一次）：

```sh
dsh plugin --profile demo add github:you/dsh-usage-stats#<commit-sha>
# 首次 add 失败后，把 pnpm 打印的包键加入 profile 的 pnpm-workspace.yaml：
#   allowBuilds:
#     dsh-usage-stats: true
# 然后重新 add
```

> 本地路径安装（`dsh plugin add ./`）走 pnpm link，**不运行** prepare——先 `pnpm build` 再 add。

## 配置（单价表）

在 profile 的 `cordis.patch.yml`（或 `--patch` overlay）覆盖：

```yaml
- patch:
    - id: dsh-usage-stats
      config:
        currency: CNY        # 计价货币：CNY（默认，¥）/ USD（$）
        models:
          deepseek-v4-flash:
            inputPerM: 0.28        # 输入未命中缓存（CNY / M tokens，默认货币）
            cacheReadPerM: 0.028   # 输入命中缓存
            outputPerM: 0.42       # 输出
            cacheWritePerM: 0.28   # 缓存写入（仅参与金额估算，不在表中展示）
```

## 已知限制 / 免责声明

- 金额为**估算值**（内置单价表 × 实际 token 四桶），非 provider 账单；单价以官方最新价为准，请自行核对。
- 计价默认货币 CNY（¥），可配置 USD（$）；单价表数值即所选货币下每 M tokens 的价格。
- `reasoningTokens` 是输出子类，不会重复计入金额。
- 未配置单价的模型：token 照常统计，金额不计入，页面提示「未配置」。
- 聚合在 node 半内存完成，无持久化缓存；数据量极大时页面加载可能变慢。
