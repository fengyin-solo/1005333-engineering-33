.PHONY: install frontend build reset-dev

install:
	cd frontend && npm install

frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

# 本地开发一键复位：检查依赖、确保 dev server 在线、把浏览器本地存储恢复为示例数据。
reset-dev:
	cd frontend && npm run reset:dev
