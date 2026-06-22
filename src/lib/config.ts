const DEFAULT_API_BASE_URL = 'http://localhost:8000'

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

export const API_BASE_URL = trimTrailingSlash(
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? DEFAULT_API_BASE_URL,
)

export const STT_PROVIDER = ((import.meta.env.VITE_STT_PROVIDER as string | undefined) ?? 'browser').toLowerCase()

export const STT_LANGUAGE = (import.meta.env.VITE_STT_LANGUAGE as string | undefined) ?? 'en-US'

export const APP_NAME = 'ProtoScribe'

export function formatProviderLabel(provider: string) {
  switch (provider) {
    case 'whisper':
      return 'Local Whisper'
    case 'deepgram':
      return 'Deepgram'
    case 'assemblyai':
      return 'AssemblyAI'
    case 'browser':
      return 'Web Speech'
    default:
      return provider
  }
}
