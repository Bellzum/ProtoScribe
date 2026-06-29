export const APP_NAME = 'ProtoScribe'
export const STT_LANGUAGE = (import.meta.env.VITE_STT_LANGUAGE as string | undefined) ?? 'en-US'
export const STT_PROVIDER = ((import.meta.env.VITE_STT_PROVIDER as string | undefined) ?? 'deepgram').toLowerCase()
