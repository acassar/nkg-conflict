import { ref } from 'vue'
import type { HelpSectionId } from '@/help/rules'

/** Aide en jeu ouverte (null = fermée) et section à afficher en premier. */
export const helpOpen = ref(false)
export const helpSection = ref<HelpSectionId | null>(null)

export function openHelp(section: HelpSectionId | null = null): void {
  helpSection.value = section
  helpOpen.value = true
}

export function closeHelp(): void {
  helpOpen.value = false
}
