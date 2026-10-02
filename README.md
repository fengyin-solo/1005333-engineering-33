# 考古发掘现场记录与出土物整理工作台

面向探方发掘进度、地层堆积编录、遗迹单位登记、出土物整理与检测送样的一体化田野考古记录工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据(seed.json) / localStorage 持久化
│   ├── src/dev-reset.ts      开发模式启动钩子：待复位时整库覆盖回示例快照
│   ├── scripts/dev-reset.mjs 一键复位脚本：查依赖、生成校验快照、置位、起复位模式服务
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理，含开发复位中间件）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 一键复位本地开发数据

换班、换人或想回到干净示例数据时，不用再手工清浏览器缓存，一条命令即可：

```bash
# 任选其一（在仓库根目录或 frontend/ 下都行）
make reset          # 仓库根目录
cd frontend && npm run dev:reset
```

命令会按顺序完成：检查运行依赖 → 由 `src/data/seed.json` 生成并校验示例快照 →
置位复位令牌 → 以「复位模式」启动 dev server。**打开页面时，浏览器 localStorage 里
`archaeology-field:entries` 整库覆盖回示例数据**：样品封装的封装记录、存放位置，以及其余
17 个模块的清单和运营概览看板全部同步回到初始状态。

说明：

- 同一轮 dev server 内刷新页面只复位一次，方便复位后继续调试；再次跑 `npm run dev:reset`
  会换发新令牌，下一次打开重新复位。普通 `npm run dev` 不触发复位。
- 复位是「整库覆盖」而不是按模块追加，脚本反复装载条目也不会变多（始终 18 个模块 / 54 条）。
- 支持断点续跑：每步结果记在 `frontend/.dev-reset/state.json`，中途失败后重跑只补未完成的步骤；
- 全程写日志到 `frontend/.dev-reset/reset.log`，失败的步骤会落日志。
- 只想置位、稍后自己起服务：`npm run reset:local`（脚本会打印随后该用的启动命令）。
- 缺依赖时脚本不擅自安装，会直接提示该跑哪条命令（通常是 `cd frontend && npm install`）。
- 所有路径都基于脚本自身位置推导，不写死本机绝对路径，换台机器克隆即可跑（需 Node 18+）。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 探方登记 | `trench` | 探方 | 探方编号、所属发掘区、布方面积 |
| 地层堆积 | `stratum` | 地层堆积 | 层位编号、所属探方、土质 |
| 遗迹单位 | `feature` | 遗迹单位 | 单位编号、遗迹类型、所属探方 |
| 出土物登记 | `find` | 出土物 | 器物编号、出土探方、出土层位 |
| 陶片拼对 | `sherd` | 拼对记录 | 拼对编号、所属单位、陶系 |
| 骨骼标本 | `bone` | 骨骼标本 | 标本编号、出土单位、种属 |
| 浮选样品 | `flotation` | 浮选样品 | 样品编号、采样单位、样品重量 |
| 测年送检 | `dating` | 测年送检单 | 送检编号、样品来源、承接实验室 |
| 测绘控制点 | `survey` | 测绘控制点 | 点位编号、控制等级、北坐标 |
| 影像资料 | `photo` | 影像资料 | 影像编号、拍摄对象、拍摄方向 |
| 发掘日记 | `diary` | 发掘日记 | 日记编号、记录日期、记录人 |
| 用工派工 | `labor` | 出工记录 | 派工编号、作业区域、用工类别 |
| 工具领用 | `tool` | 工具领用单 | 领用单号、领用人、工具名称 |
| 安全巡查 | `safety` | 安全巡查记录 | 巡查编号、巡查区域、巡查类别 |
| 样品封装 | `packing` | 封装记录 | 封装编号、所属单位、封装材料 |
| 标本修复 | `conserve` | 修复单 | 修复单号、修复对象、病害描述 |
| 简报校核 | `briefing` | 发掘简报 | 简报编号、涉及探方、编写人 |
| 探方验收 | `acceptance` | 探方验收单 | 验收单号、验收探方、验收类别 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：本地开发用一键命令 `npm run dev:reset`（见上文「一键复位本地开发数据」）；
  浏览器里也可清掉 `archaeology-field:entries` 这一项，或调用 `resetModule(模块)` 只复位单个模块。
