<script setup lang="ts">
import { computed } from 'vue'
import { useGameStore } from '@/stores/game'
import ForcesContent from './ForcesContent.vue'
import ProductionTab from './ProductionTab.vue'
import CountryTab from './CountryTab.vue'
import EventLog from './EventLog.vue'
import type { Domain, InspectKind } from '@/stores/frame'

/** Contenu d'un tiroir du rail (domain) ou de l'inspecteur (inspector), repris des anciens onglets. */
const props = defineProps<{ kind: 'domain' | 'inspector'; view: Domain | InspectKind }>()

const game = useGameStore()
const noEvents = computed(
  () => props.kind === 'domain' && props.view === 'log' && !game.snapshot?.events.length,
)
</script>

<template>
  <template v-if="kind === 'domain'">
    <ForcesContent v-if="view === 'forces'" section="forces" />
    <ProductionTab v-else-if="view === 'production'" />
    <CountryTab v-else-if="view === 'country'" own />
    <template v-else>
      <EventLog embedded :limit="40" />
      <p v-if="noEvents" class="empty">Aucun événement pour l'instant.</p>
    </template>
  </template>
  <template v-else>
    <ForcesContent v-if="view === 'units'" section="units" />
    <ForcesContent v-else-if="view === 'army'" section="army" />
    <ProductionTab v-else-if="view === 'city'" part="city" />
    <CountryTab v-else />
  </template>
</template>

<style scoped>
.empty {
  color: #9aa3af;
}
</style>
