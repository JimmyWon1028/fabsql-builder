import { createApp } from 'vue'

import App from './App.vue'
import {
  initializeApplicationPreferences
} from './preferences/use-application-preferences'
import './styles/application.css'

await initializeApplicationPreferences()
createApp(App).mount('#app')
