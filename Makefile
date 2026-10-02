.PHONY: install frontend build reset reset-arm

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

# 一键复位本地开发数据：检查依赖 → 生成并校验示例快照 → 置位 → 以复位模式起 dev server
reset:
	cd frontend && npm run dev:reset

# 只做复位准备（置位 + 令牌），不起服务
reset-arm:
	cd frontend && npm run reset:local
