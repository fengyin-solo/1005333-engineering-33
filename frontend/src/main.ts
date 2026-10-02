import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { applyDevReset } from './dev-reset'
import './styles/global.css'

// 开发复位模式下先把 localStorage 整库覆盖回示例数据，再挂载应用，保证首屏清单就是初始状态。
applyDevReset().finally(() => {
  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.mount('#app')
})
