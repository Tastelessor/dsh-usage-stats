# dsh-usage-stats

dsh（DeepSeek Harness）外部插件：在 Web 设置面板新增「用量统计」页，展示过去 7/15/30 天的
token 用量与估算金额折线图，以及当前已接入模型的 M tokens 单价表（输入命中缓存 / 输入未命中缓存 / 输出），
并支持在页面内直接编辑两种货币下的模型单价。

## 功能

- 设置 → 用量统计：时间范围切换（7/15/30 天）、token 用量折线图（总量 / 输入 / 输出 / 缓存 / 推理）、金额折线图（CNY 与 USD 双系列）、折线图 hover 显示具体数值。
- 汇总卡片：Token 总量、日均 Token、平均缓存命中率、估算金额（CNY 与 USD 同时展示）。
- 模型单价表：展示当前已接入模型（来自 `ctx.llm` 模型目录）在 **CNY 与 USD 两种货币**下的单价；默认内置 `deepseek-v4-flash` 与 `deepseek-v4-pro` 价格。
- **单价编辑**：单价表内切换 CNY/USD 币种，内联修改价格后点「保存单价」写回配置，统计自动按新价刷新。
- 数据来源：历史会话日志中 `assistant/message` 事件携带的 `usage`（纯观察者，不改动 agent-loop）。
- 性能：按 session 文件 mtime 剪枝 + 有界并发读取 + 30s 响应缓存，实测 69 个 session 由 12.8s 降至约 1s（热缓存 <1ms）；客户端在页面激活时并行预取 7/15/30 天三档数据并做 30s 本地缓存，**切换日期范围即时渲染**（无 loading 闪烁、无额外请求）。

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

在 profile 的 `cordis.patch.yml`（或 `--patch` overlay）覆盖；两种货币分别配置，缺省沿用内置默认价：

```yaml
- patch:
    - id: dsh-usage-stats
      config:
        currency: CNY        # 首选币种：CNY（默认，¥）/ USD（$）
        models:
          deepseek-v4-flash:
            cny:             # 人民币单价（¥ / M tokens）
              inputPerM: 0.28        # 输入未命中缓存
              cacheReadPerM: 0.028   # 输入命中缓存
              outputPerM: 0.42       # 输出
              cacheWritePerM: 0.28   # 缓存写入（仅参与金额估算，不在表中展示）
            usd:             # 美元单价（$ / M tokens）
              inputPerM: 0.039
              cacheReadPerM: 0.004
              outputPerM: 0.058
              cacheWritePerM: 0.039
```

> 页面内「保存单价」等价于写入上述 `models.<id>.cny|usd`，无需手改配置。

> 实现说明：dsh 的 Web 配置 API（`settings.mutate`）只对宿主内置命名空间白名单开放，外部插件命名空间会被拒（`settings-not-exposed`），因此价格写回走插件自有的 `POST /dsh-usage-stats/prices` 路由，由 node 半在进程内调用 `ctx.settings` 落盘（与手改配置完全等价）。

## 已知限制 / 免责声明

- 金额为**估算值**（内置单价表 × 实际 token 四桶），非 provider 账单；单价以官方最新价为准，请自行核对（内置 USD 价暂按 7.2 汇率折算，待核）。
- 金额同时按 CNY 与 USD 估算并同屏展示；两种货币的单价独立配置。
- `reasoningTokens` 是输出子类，不会重复计入金额。
- 两种货币都未配置单价的模型：token 照常统计，金额不计入，页面提示「未配置」。
- 聚合在 node 半内存完成，仅 30s 短时缓存；数据量极大时首次加载可能仍需数秒（此后切换范围由客户端预取缓存即时渲染）。
