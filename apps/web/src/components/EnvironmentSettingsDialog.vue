<script setup lang="ts">
import type {
  ApiProvider,
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
import {
  isLaravelAuthenticatedForUrl,
  laravelAuthentication,
  loginToLaravel,
  logoutFromLaravel
} from '../services/laravel-auth'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
  applied: [response: DatabaseConnectionApplyResponse]
  apiSourceApplied: [provider: ApiProvider]
  laravelSignedOut: []
}>()

type SettingsSection = 'api' | 'database' | 'language' | 'theme'

const {
  apiProvider,
  laravelApiUrl,
  locale,
  theme,
  setApiSource,
  setLocale,
  setTheme,
  t
} = useApplicationPreferences()
const activeSection = ref<SettingsSection>('api')
const dialog = ref<HTMLElement | null>(null)
const selectedApiProvider = ref<ApiProvider>(apiProvider.value)
const laravelUrl = ref(laravelApiUrl.value)
const laravelEmail = ref('')
const laravelPassword = ref('')
const apiFeedback = ref('')
const apiFeedbackType = ref<'success' | 'error' | ''>('')
const isApiApplying = ref(false)
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
const isSelectedLaravelAuthenticated = computed(() => {
  laravelAuthentication.value

  return isLaravelAuthenticatedForUrl(laravelUrl.value)
})
const selectedLaravelUser = computed(() => {
  if (!isSelectedLaravelAuthenticated.value) {
    return null
  }

  return laravelAuthentication.value?.user ?? null
})
const activeApiProviderLabel = computed(() =>
  apiProviderLabel(apiProvider.value)
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

function apiProviderLabel(provider: ApiProvider): string {
  if (provider === 'fastify') {
    return t('settings.databaseMode')
  }

  if (provider === 'session') {
    return t('settings.sessionMode')
  }

  return t('settings.apiMode')
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
    setApiSource('fastify', laravelUrl.value)
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
  if (!isApplying.value && !isApiApplying.value) {
    emit('close')
  }
}

function isValidLaravelUrl(value: string): boolean {
  try {
    const parsedUrl = new URL(value)
    return parsedUrl.protocol === 'http:'
      || parsedUrl.protocol === 'https:'
  } catch {
    return false
  }
}

async function handleApplyApiSource(): Promise<void> {
  if (isApiApplying.value) {
    return
  }

  const normalizedUrl = laravelUrl.value.trim().replace(/\/+$/, '')

  if (
    selectedApiProvider.value !== 'fastify'
    && !isValidLaravelUrl(normalizedUrl)
  ) {
    apiFeedback.value = t('settings.apiInvalidUrl')
    apiFeedbackType.value = 'error'
    return
  }

  if (
    selectedApiProvider.value === 'laravel'
    && !isSelectedLaravelAuthenticated.value
    && (!laravelEmail.value.trim() || !laravelPassword.value)
  ) {
    apiFeedback.value = t('settings.laravelCredentialsRequired')
    apiFeedbackType.value = 'error'
    return
  }

  isApiApplying.value = true
  apiFeedback.value = ''
  apiFeedbackType.value = ''

  try {
    if (
      selectedApiProvider.value === 'laravel'
      && !isSelectedLaravelAuthenticated.value
    ) {
      const user = await loginToLaravel(
        normalizedUrl,
        laravelEmail.value.trim(),
        laravelPassword.value
      )

      apiFeedback.value = t('settings.laravelSignedIn', {
        email: user.email
      })
      apiFeedbackType.value = 'success'
      laravelPassword.value = ''
    }

    setApiSource(selectedApiProvider.value, normalizedUrl)
    laravelUrl.value = laravelApiUrl.value

    if (!apiFeedback.value) {
      apiFeedback.value = t('settings.apiApplied', {
        provider: apiProviderLabel(selectedApiProvider.value)
      })
      apiFeedbackType.value = 'success'
    }

    emit('apiSourceApplied', selectedApiProvider.value)
  } catch (error) {
    apiFeedback.value = error instanceof Error
      ? error.message
      : t('app.authenticationRequired')
    apiFeedbackType.value = 'error'
  } finally {
    isApiApplying.value = false
  }
}

async function handleLaravelSignOut(): Promise<void> {
  if (isApiApplying.value) {
    return
  }

  isApiApplying.value = true

  try {
    await logoutFromLaravel()
  } catch {
    // The local token is cleared even if the remote logout fails.
  } finally {
    apiFeedback.value = t('settings.laravelSignedOut')
    apiFeedbackType.value = 'success'
    laravelPassword.value = ''
    isApiApplying.value = false
    emit('laravelSignedOut')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      selectedApiProvider.value = apiProvider.value
      laravelUrl.value = laravelApiUrl.value
      laravelEmail.value = laravelAuthentication.value?.user.email ?? ''
      laravelPassword.value = ''
      apiFeedback.value = ''
      apiFeedbackType.value = ''
      activeSection.value = 'api'
      void nextTick(() => dialog.value?.focus())
    } else {
      loadSequence += 1
    }
  }
)

watch(activeSection, (section) => {
  if (props.open && section === 'database' && !loadedSettings.value) {
    void loadSettings()
  }
})
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
                  activeSection === 'api'
              }"
              type="button"
              @click="activeSection = 'api'"
            >
              <span aria-hidden="true">⇄</span>
              <span class="settings-navigation__label">
                <span>{{ t('settings.connectionMode') }}</span>
                <small>
                  {{ t('settings.currentMode', {
                    mode: activeApiProviderLabel
                  }) }}
                </small>
              </span>
            </button>
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

          <section
            v-if="activeSection === 'api'"
            class="preference-settings"
            aria-labelledby="api-settings-title"
          >
            <p class="eyebrow">CONNECTION</p>
            <h3 id="api-settings-title">
              {{ t('settings.connectionMode') }}
            </h3>
            <p class="settings-description">
              {{ t('settings.connectionModeDescription') }}
            </p>

            <div class="preference-options">
              <label
                class="preference-option"
                :class="{
                  'preference-option--selected':
                    selectedApiProvider === 'fastify'
                }"
              >
                <input
                  v-model="selectedApiProvider"
                  type="radio"
                  name="api-provider"
                  value="fastify"
                  @change="
                    apiFeedback = '';
                    apiFeedbackType = ''
                  "
                >
                <span>
                  <strong>{{ t('settings.databaseMode') }}</strong>
                  <small>{{ t('settings.databaseModeHint') }}</small>
                </span>
              </label>

              <label
                class="preference-option"
                :class="{
                  'preference-option--selected':
                    selectedApiProvider === 'laravel'
                }"
              >
                <input
                  v-model="selectedApiProvider"
                  type="radio"
                  name="api-provider"
                  value="laravel"
                  @change="
                    apiFeedback = '';
                    apiFeedbackType = ''
                  "
                >
                <span>
                  <strong>{{ t('settings.apiMode') }}</strong>
                  <small>{{ t('settings.apiModeHint') }}</small>
                </span>
              </label>

              <label
                class="preference-option"
                :class="{
                  'preference-option--selected':
                    selectedApiProvider === 'session'
                }"
              >
                <input
                  v-model="selectedApiProvider"
                  type="radio"
                  name="api-provider"
                  value="session"
                  @change="
                    apiFeedback = '';
                    apiFeedbackType = ''
                  "
                >
                <span>
                  <strong>{{ t('settings.sessionMode') }}</strong>
                  <small>{{ t('settings.sessionModeHint') }}</small>
                </span>
              </label>
            </div>

            <div
              v-if="selectedApiProvider !== 'fastify'"
              class="settings-field settings-field--wide"
            >
              <label for="laravel-api-url">
                {{ t('settings.laravelUrl') }}
              </label>
              <input
                id="laravel-api-url"
                v-model="laravelUrl"
                type="url"
                inputmode="url"
                autocomplete="url"
                placeholder="http://api.jl.test"
                @input="
                  apiFeedback = '';
                  apiFeedbackType = ''
                "
              >
            </div>

            <div
              v-if="
                selectedApiProvider === 'laravel'
                && isSelectedLaravelAuthenticated
              "
              class="settings-security-note"
            >
              <span>
                {{ t('settings.laravelSignedInAs', {
                  email: selectedLaravelUser?.email ?? ''
                }) }}
              </span>
              <button
                type="button"
                :disabled="isApiApplying"
                @click="handleLaravelSignOut"
              >
                {{ t('common.signOut') }}
              </button>
            </div>

            <div
              v-else-if="selectedApiProvider === 'laravel'"
              class="settings-field-grid settings-field-grid--equal"
            >
              <div class="settings-field">
                <label for="laravel-email">
                  {{ t('settings.laravelEmail') }}
                </label>
                <input
                  id="laravel-email"
                  v-model="laravelEmail"
                  type="email"
                  autocomplete="username"
                  @input="
                    apiFeedback = '';
                    apiFeedbackType = ''
                  "
                >
              </div>
              <div class="settings-field">
                <label for="laravel-password">
                  {{ t('settings.laravelPassword') }}
                </label>
                <input
                  id="laravel-password"
                  v-model="laravelPassword"
                  type="password"
                  autocomplete="current-password"
                  @input="
                    apiFeedback = '';
                    apiFeedbackType = ''
                  "
                  @keydown.enter.prevent="handleApplyApiSource"
                >
              </div>
            </div>

            <p
              v-if="selectedApiProvider === 'session'"
              class="settings-security-note"
            >
              {{ t('settings.sessionNote') }}
            </p>

            <p
              v-if="apiFeedback"
              class="settings-feedback"
              :class="`settings-feedback--${apiFeedbackType}`"
              role="status"
            >
              {{ apiFeedback }}
            </p>

            <footer class="settings-dialog__actions">
              <button
                class="button--primary"
                type="button"
                :disabled="isApiApplying"
                @click="handleApplyApiSource"
              >
                {{
                  isApiApplying
                    ? selectedApiProvider === 'laravel'
                      && !isSelectedLaravelAuthenticated
                      ? t('common.signingIn')
                      : t('common.applying')
                    : selectedApiProvider === 'laravel'
                      && !isSelectedLaravelAuthenticated
                      ? t('common.signIn')
                      : t('common.apply')
                }}
              </button>
            </footer>
          </section>

          <form
            v-else-if="activeSection === 'database'"
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
