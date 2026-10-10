<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { HELP_SECTIONS } from '@/help/rules'
import { closeHelp, helpOpen, helpSection } from '@/composables/help'
import { isMobile } from '@/composables/layout'

const body = ref<HTMLElement | null>(null)

/** Fait défiler jusqu'à la section demandée (depuis un modificateur de l'écran de bataille). */
async function scrollToSection(): Promise<void> {
  await nextTick()
  const id = helpSection.value
  const el = id ? body.value?.querySelector<HTMLElement>(`[data-section="${id}"]`) : null
  if (body.value) body.value.scrollTop = el ? el.offsetTop : 0
}
watch([helpOpen, helpSection], () => {
  if (helpOpen.value) void scrollToSection()
})

function onKey(event: KeyboardEvent): void {
  if (helpOpen.value && event.key === 'Escape') {
    event.stopImmediatePropagation()
    closeHelp()
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div v-if="helpOpen" class="backdrop" @click.self="closeHelp()">
    <div
      class="help"
      :class="{ mobile: isMobile }"
      role="dialog"
      aria-label="Aide : règles du jeu"
      data-testid="rules-help"
    >
      <header>
        <strong>Aide : règles et modificateurs</strong>
        <button aria-label="Fermer l'aide" @click="closeHelp()">✕</button>
      </header>
      <nav>
        <button
          v-for="s in HELP_SECTIONS"
          :key="s.id"
          :class="{ active: helpSection === s.id }"
          @click="helpSection = s.id"
        >
          {{ s.title }}
        </button>
      </nav>
      <div ref="body" class="body">
        <section v-for="s in HELP_SECTIONS" :key="s.id" :data-section="s.id">
          <h3>{{ s.title }}</h3>
          <p v-for="(p, i) in s.paragraphs" :key="i">{{ p }}</p>
          <div v-if="s.table" class="table">
            <table>
              <thead>
                <tr>
                  <th v-for="h in s.table.head" :key="h">{{ h }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in s.table.rows" :key="row[0]">
                  <td v-for="(c, i) in row" :key="i">{{ c }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
}
.help {
  width: min(680px, calc(100vw - 32px));
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  background: #1b2028;
  color: #e8eaed;
  border: 1px solid #3b4250;
  border-radius: 10px;
  font:
    13px/1.45 system-ui,
    sans-serif;
  overflow: hidden;
}
.help.mobile {
  width: 100vw;
  height: 100dvh;
  max-height: none;
  border-radius: 0;
  border: none;
  padding-top: env(safe-area-inset-top);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid #2c323c;
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 14px;
  border-bottom: 1px solid #2c323c;
}
.body {
  overflow-y: auto;
  padding: 4px 14px 14px;
  position: relative;
}
h3 {
  margin: 12px 0 4px;
  font-size: 14px;
}
p {
  margin: 4px 0;
}
.table {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  margin-top: 6px;
  font-size: 12px;
}
th,
td {
  text-align: left;
  padding: 3px 8px 3px 0;
  border-bottom: 1px solid #2c323c;
  vertical-align: top;
}
th {
  color: #9aa3af;
  font-weight: 600;
}
button {
  background: #2c323c;
  color: inherit;
  border: 1px solid #3b4250;
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
  font: inherit;
}
button.active {
  background: #2563eb;
  border-color: #2563eb;
}
.help.mobile button {
  padding: 6px 10px;
}
</style>
