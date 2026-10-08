import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { useGameStore } from './stores/game'

const app = createApp(App).use(createPinia())
app.mount('#app')

// Accès au store depuis la console et les tests de fumée (e2e/smoke.mjs).
;(window as unknown as { __nkg: unknown }).__nkg = useGameStore()
