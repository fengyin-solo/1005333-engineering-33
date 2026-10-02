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
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   ├── scripts/reset-dev.mjs 一键复位脚本（npm run reset:dev）
│   ├── plugins/              仅开发环境生效的 Vite 插件（复位页与状态接口）
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
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

## 本地开发数据一键复位

本地开发时数据持久化在浏览器 `localStorage`，上一轮跑出来的封装记录、存放位置等
改动会一直留着，换人/换轮次看到的就是脏数据。一键复位把全部模块（含样品封装）的
本地存储整体恢复成 `seed.ts` 示例数据，其他模块清单也同步回到初始状态：

```bash
make reset-dev
# 或
cd frontend && npm run reset:dev
```

脚本会依次完成（任一步失败可直接重跑，只补未完成的步骤）：

1. **依赖检查**：核对 `node_modules` 是否装齐；缺依赖会直接提示执行 `npm install`。
2. **拉起 dev server**：已在运行就复用，没运行自动在后台拉起（不写死本机路径，换机器可直接跑）。
3. **执行复位**：自动打开复位页，把 `archaeology-field:entries` 整体覆盖为示例数据并逐条校验，
   各模块条数通过后自动跳回首页。复位是「整体覆盖」而不是合并，反复执行条目不会增多。

没有图形界面/浏览器无法自动打开时，终端会打印复位页地址，手工在浏览器打开即可，
之后重跑命令即可拿到结果。执行过程（含失败原因）记录在 `frontend/.dev-reset/reset.log`，
步骤状态在 `frontend/.dev-reset/state.json`（均已 gitignore）。可用
`RESET_TIMEOUT_MS=毫秒数` 调整等待浏览器回传的超时时间。

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
- 想回到初始数据：运行 `npm run reset:dev`（推荐，一键复位全部模块）；
  也可以清掉浏览器里 `archaeology-field:entries` 这一项，或调用 `resetModule(模块)` 只复位单个模块。
