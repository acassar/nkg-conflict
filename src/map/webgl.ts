/**
 * Texte lisible d'une erreur de création du contexte WebGL. MapLibre renvoie parfois un objet JSON
 * (statusMessage du navigateur, par exemple « FEATURE_FAILURE_EGL_NO_CONFIG » sous Firefox).
 */
export function glErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  try {
    const parsed = JSON.parse(raw) as { statusMessage?: string; message?: string } | null
    return parsed?.statusMessage || parsed?.message || raw
  } catch {
    return raw
  }
}
