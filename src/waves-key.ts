// The localStorage slot the Wave Editor (src/wave-editor/) hands a wave list
// to the play page through — both are pages of this site, so they share the
// origin — and which src/web/waves-param.ts reads when the play page opens
// with ?waves=local.
export const WAVES_STORAGE_KEY = 'shmup-party-ps2:waves'
