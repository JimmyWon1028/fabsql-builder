<script setup lang="ts">
import type {
  ApplicationLocale,
  ApplicationTheme
} from '../preferences/use-application-preferences'
import {
  useApplicationPreferences
} from '../preferences/use-application-preferences'
import type {
  DatabaseConnectionApplyResponse,
  DatabaseConnectionInput,
  DatabaseConnectionMode,
  DatabaseConnectionSettings
} from '@sql-builder/shared'
import {
  computed,
  nextTick,
  reactive,
  ref,
  watch
} from 'vue'

import {
  applyDatabaseConnection,
  getDatabaseConnectionSettings,
  testDatabaseConnection
} from '../services/schema-api'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  applied: [response: DatabaseConnectionApplyResponse]
}>()

type SettingsSection = 'database' | 'language' | 'theme'

const {
  locale,
  theme,
  setLocale,
  setTheme,
  t
} = useApplicationPreferences()
const activeSection = ref<SettingsSection>('database')
const dialog = ref<HTMLElement | null>(null)
const loadedSettings = ref<DatabaseConnectionSettings | null>(null)
const password = ref('')
const clearPassword = ref(false)
const isLoading = ref(false)
const isTesting = ref(false)
const isApplying = ref(false)
const feedback = ref('')
const feedbackType = ref<'success' | 'error' | ''>('')
let loadSequence = 0

const form = reactive({
  mode: 'socket' as DatabaseConnectionMode,
  database: '',
  user: '',
  host: '127.0.0.1',
  port: 3306,
  socketPath: '/tmp/mysql.sock'
})

const isBusy = computed(() =>
  isLoading.value || isTesting.value || isApplying.value
)

const isFormComplete = computed(() =>
  Boolean(
    form.database.trim()
    && form.user.trim()
    && (
      form.mode === 'socket'
        ? form.socketPath.trim()
        : form.host.trim()
          && Number.isInteger(Number(form.port))
          && Number(form.port) >= 1
          && Number(form.port) <= 65535
    )
  )
)

function populateForm(settings: DatabaseConnectionSettings): void {
  loadedSettings.value = settings
  form.mode = settings.mode
  form.database = settings.database
  form.user = settings.user
  form.host = settings.host
  form.port = settings.port
  form.socketPath = settings.socketPath
  password.value = ''
  clearPassword.value = false
}

function connectionInput(): DatabaseConnectionInput {
  return {
    mode: form.mode,
    database: form.database.trim(),
    user: form.user.trim(),
    host: form.host.trim(),
    port: Number(form.port),
    socketPath: form.socketPath.trim(),
    ...(password.value ? { password: password.value } : {}),
    ...(clearPassword.value ? { clearPassword: true } : {})
  }
}

function showFeedback(
  message: string,
  type: 'success' | 'error'
): void {
  feedback.value = message
  feedbackType.value = type
}

async function loadSettings(): Promise<void> {
  const sequence = ++loadSequence
  isLoading.value = true
  feedback.value = ''
  feedbackType.value = ''

  try {
    const settings = await getDatabaseConnectionSettings()

    if (sequence === loadSequence && props.open) {
      populateForm(settings)
      await nextTick()
      dialog.value?.focus()
    }
  } catch (error) {
    if (sequence === loadSequence) {
      showFeedback(
        error instanceof Error
          ? error.message
          : t('settings.loadFailed'),
        'error'
      )
    }
  } finally {
    if (sequence === loadSequence) {
      isLoading.value = false
    }
  }
}

async function handleTestConnection(): Promise<void> {
  if (!isFormComplete.value || isBusy.value) {
    return
  }

  isTesting.value = true
  feedback.value = ''

  try {
    const response = await testDatabaseConnection(connectionInput())
    showFeedback(
      t('settings.testSuccess', {
        version: response.version
      }),
      'success'
    )
  } catch (error) {
    showFeedback(
      error instanceof Error
        ? error.message
        : t('settings.testFailed'),
      'error'
    )
  } finally {
    isTesting.value = false
  }
}

async function handleApply(): Promise<void> {
  if (!isFormComplete.value || isBusy.value) {
    return
  }

  isApplying.value = true
  feedback.value = ''

  try {
    const response = await applyDatabaseConnection(connectionInput())
    populateForm(response.settings)
    emit('applied', response)
  } catch (error) {
    showFeedback(
      error instanceof Error
        ? error.message
        : t('settings.applyFailed'),
      'error'
    )
  } finally {
    isApplying.value = false
  }
}

function handleClose(): void {
  if (!isApplying.value) {
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      void loadSettings()
    } else {
      loadSequence += 1
    }
  }
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="settings-overlay"
      @pointerdown.self="handleClose"
    >
      <section
        ref="dialog"
        class="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="environment-settings-title"
        tabindex="-1"
        @keydown.esc.prevent="handleClose"
      >
        <header class="settings-dialog__header">
          <div>
            <p class="eyebrow">{{ t('settings.environment') }}</p>
            <h2 id="environment-settings-title">
              {{ t('settings.title') }}
            </h2>
          </div>
          <button
            class="settings-dialog__close"
            type="button"
            :aria-label="t('common.close')"
            :title="t('common.close')"
            @click="handleClose"
          >
            ×
          </button>
        </header>

        <div class="settings-dialog__body">
          <nav
            class="settings-navigation"
            :aria-label="t('settings.items')"
          >
            <button
              class="settings-navigation__item"
              :class="{
                'settings-navigation__item--active':
                  activeSection === 'database'
              }"
              type="button"
              @click="activeSection = 'database'"
            >
              <span aria-hidden="true">▦</span>
              {{ t('settings.database') }}
            </button>
            <button
              class="settings-navigation__item"
              :class="{
                'settings-navigation__item--active':
                  activeSection === 'language'
              }"
              type="button"
              @click="activeSection = 'language'"
            >
              <span aria-hidden="true">文</span>
              {{ t('settings.language') }}
            </button>
            <button
              class="settings-navigation__item"
              :class="{
                'settings-navigation__item--active':
                  activeSection === 'theme'
              }"
              type="button"
              @click="activeSection = 'theme'"
            >
              <span aria-hidden="true">◐</span>
              {{ t('settings.theme') }}
            </button>
          </nav>

          <form
            v-if="activeSection === 'database'"
            class="database-settings"
            @submit.prevent="handleApply"
          >
            <div class="database-settings__heading">
              <div>
                <p class="eyebrow">MARIADB</p>
                <h3>{{ t('settings.database') }}</h3>
              </div>
              <span
                v-if="loadedSettings?.passwordConfigured"
                class="password-status"
              >
                {{ t('settings.passwordConfigured') }}
              </span>
            </div>

            <p class="settings-description">
              {{ t('settings.databaseDescription') }}
            </p>

            <fieldset :disabled="isBusy">
              <legend>{{ t('settings.connectionMethod') }}</legend>
              <div class="connection-mode-options">
                <label
                  :class="{
                    'connection-mode-option--selected':
                      form.mode === 'socket'
                  }"
                  class="connection-mode-option"
                >
                  <input
                    v-model="form.mode"
                    type="radio"
                    value="socket"
                  >
                  <span>
                    <strong>Unix Socket</strong>
                    <small>{{ t('settings.localSocket') }}</small>
                  </span>
                </label>
                <label
                  :class="{
                    'connection-mode-option--selected':
                      form.mode === 'network'
                  }"
                  class="connection-mode-option"
                >
                  <input
                    v-model="form.mode"
                    type="radio"
                    value="network"
                  >
                  <span>
                    <strong>Host / Port</strong>
                    <small>{{ t('settings.network') }}</small>
                  </span>
                </label>
              </div>

              <div
                v-if="form.mode === 'socket'"
                class="settings-field settings-field--wide"
              >
                <label for="database-socket-path">
                  {{ t('settings.socketPath') }}
                </label>
                <input
                  id="database-socket-path"
                  v-model="form.socketPath"
                  type="text"
                  autocomplete="off"
                  placeholder="/tmp/mysql.sock"
                >
              </div>

              <div v-else class="settings-field-grid">
                <div class="settings-field">
                  <label for="database-host">
                    {{ t('settings.host') }}
                  </label>
                  <input
                    id="database-host"
                    v-model="form.host"
                    type="text"
                    autocomplete="off"
                    placeholder="127.0.0.1"
                  >
                </div>
                <div class="settings-field settings-field--port">
                  <label for="database-port">
                    {{ t('settings.port') }}
                  </label>
                  <input
                    id="database-port"
                    v-model.number="form.port"
                    type="number"
                    min="1"
                    max="65535"
                    inputmode="numeric"
                  >
                </div>
              </div>

              <div class="settings-field-grid settings-field-grid--equal">
                <div class="settings-field">
                  <label for="database-user">
                    {{ t('settings.user') }}
                  </label>
                  <input
                    id="database-user"
                    v-model="form.user"
                    type="text"
                    autocomplete="username"
                  >
                </div>
                <div class="settings-field">
                  <label for="database-name">
                    {{ t('settings.databaseName') }}
                  </label>
                  <input
                    id="database-name"
                    v-model="form.database"
                    type="text"
                    autocomplete="off"
                  >
                </div>
              </div>

              <div class="settings-field settings-field--wide">
                <label for="database-password">
                  {{ t('settings.password') }}
                </label>
                <input
                  id="database-password"
                  v-model="password"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="loadedSettings?.passwordConfigured
                    ? t('settings.keepPassword')
                    : t('common.optional')"
                  @input="clearPassword = false"
                >
              </div>

              <label
                v-if="loadedSettings?.passwordConfigured"
                class="clear-password-option"
              >
                <input
                  v-model="clearPassword"
                  type="checkbox"
                  @change="password = ''"
                >
                {{ t('settings.clearPassword') }}
              </label>
            </fieldset>

            <p class="settings-security-note">
              {{ t('settings.security') }}
            </p>

            <p
              v-if="feedback"
              class="settings-feedback"
              :class="`settings-feedback--${feedbackType}`"
              role="status"
            >
              {{ feedback }}
            </p>

            <footer class="settings-dialog__actions">
              <button
                type="button"
                :disabled="!isFormComplete || isBusy"
                @click="handleTestConnection"
              >
                {{ isTesting
                  ? t('settings.testing')
                  : t('settings.test') }}
              </button>
              <button
                class="button--primary"
                type="submit"
                :disabled="!isFormComplete || isBusy"
              >
                {{ isApplying
                  ? t('common.applying')
                  : t('common.apply') }}
              </button>
            </footer>
          </form>

          <section
            v-else-if="activeSection === 'language'"
            class="preference-settings"
            aria-labelledby="language-settings-title"
          >
            <p class="eyebrow">LANGUAGE</p>
            <h3 id="language-settings-title">
              {{ t('settings.language') }}
            </h3>
            <p class="settings-description">
              {{ t('settings.languageDescription') }}
            </p>

            <div class="preference-options">
              <label
                v-for="option in ([
                  {
                    value: 'en',
                    label: t('settings.english'),
                    sample: 'English'
                  },
                  {
                    value: 'zh-Hant',
                    label: t('settings.traditionalChinese'),
                    sample: '繁體中文'
                  },
                  {
                    value: 'zh-Hans',
                    label: t('settings.simplifiedChinese'),
                    sample: '简体中文'
                  }
                ] as Array<{
                  value: ApplicationLocale
                  label: string
                  sample: string
                }>)"
                :key="option.value"
                class="preference-option"
                :class="{
                  'preference-option--selected':
                    locale === option.value
                }"
              >
                <input
                  :checked="locale === option.value"
                  type="radio"
                  name="application-language"
                  :value="option.value"
                  @change="setLocale(option.value)"
                >
                <span>
                  <strong>{{ option.label }}</strong>
                  <small>{{ option.sample }}</small>
                </span>
              </label>
            </div>

            <p class="preference-save-note">
              {{ t('settings.savedAutomatically') }}
            </p>
          </section>

          <section
            v-else
            class="preference-settings"
            aria-labelledby="theme-settings-title"
          >
            <p class="eyebrow">THEME</p>
            <h3 id="theme-settings-title">
              {{ t('settings.theme') }}
            </h3>
            <p class="settings-description">
              {{ t('settings.themeDescription') }}
            </p>

            <div class="theme-options">
              <label
                v-for="option in ([
                  {
                    value: 'blue',
                    label: t('settings.themeBlue'),
                    hint: t('settings.themeBlueHint')
                  },
                  {
                    value: 'monochrome',
                    label: t('settings.themeMonochrome'),
                    hint: t('settings.themeMonochromeHint')
                  },
                  {
                    value: 'red',
                    label: t('settings.themeRed'),
                    hint: t('settings.themeRedHint')
                  },
                  {
                    value: 'green',
                    label: t('settings.themeGreen'),
                    hint: t('settings.themeGreenHint')
                  }
                ] as Array<{
                  value: ApplicationTheme
                  label: string
                  hint: string
                }>)"
                :key="option.value"
                class="theme-option"
                :class="[
                  `theme-option--${option.value}`,
                  {
                    'theme-option--selected':
                      theme === option.value
                  }
                ]"
              >
                <input
                  :checked="theme === option.value"
                  type="radio"
                  name="application-theme"
                  :value="option.value"
                  @change="setTheme(option.value)"
                >
                <span
                  class="theme-option__preview"
                  aria-hidden="true"
                >
                  <i></i><i></i><i></i>
                </span>
                <span>
                  <strong>{{ option.label }}</strong>
                  <small>{{ option.hint }}</small>
                </span>
              </label>
            </div>

            <p class="preference-save-note">
              {{ t('settings.savedAutomatically') }}
            </p>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>
