// Single source of truth for the semantic voice actions DashboardPage registers.
// Shared between DashboardPage.jsx and its coverage test so the two cannot drift apart.

export function buildDashboardVoiceActions({
  setView,
  setActiveCategory,
  setHistoryOpen,
  setVoiceChatOpen,
  setGuideOpen,
  setJWT,
  disconnectSocket,
  onLogout,
  dispatch,
}) {
  return [
    { name: 'navigate_home',      description: 'Go to the home / map monitoring view',        params: {},                                                   handler: () => setView('home') },
    { name: 'navigate_analysis',  description: 'Open the analysis workspace',                  params: { category: 'optional: savunma|enerji|saldiri|ekonomi|toplumsal|danisma|saglik|cok-alanli' }, handler: (p) => { setActiveCategory(p?.category || null); setView('analysis'); } },
    { name: 'navigate_history',   description: 'Open the history / past analyses view',        params: {},                                                   handler: () => setHistoryOpen(true) },
    { name: 'new_analysis',       description: 'Start a new analysis with no preset category', params: {},                                                   handler: () => { setActiveCategory(null); setView('analysis'); } },
    { name: 'open_voice_chat',    description: 'Open the voice consultation chat modal',       params: {},                                                   handler: () => setVoiceChatOpen(true) },
    { name: 'close_voice_chat',   description: 'Close the voice consultation chat',            params: {},                                                   handler: () => setVoiceChatOpen(false) },
    { name: 'open_guide',         description: 'Open the usage guide',                         params: {},                                                   handler: () => setGuideOpen(true) },
    { name: 'close_guide',        description: 'Close the usage guide',                        params: {},                                                   handler: () => setGuideOpen(false) },
    { name: 'logout',             description: 'Log out of the system',                        params: {},                                                   handler: () => { setJWT(null); disconnectSocket(); onLogout(); } },
    { name: 'open_emergency',     description: 'Open the emergency center panel',              params: {},                                                   handler: () => dispatch('aq:emergency:open', {}) },
    { name: 'set_analysis_title',  description: 'Set the analysis report title text',          params: { value: 'string' },                                  handler: (p) => dispatch('aq:analysis:set', { field: 'title',  value: p?.value || '' }) },
    { name: 'set_analysis_prompt', description: 'Set / fill the analysis topic or brief',      params: { value: 'string' },                                  handler: (p) => dispatch('aq:analysis:set', { field: 'prompt', value: p?.value || '' }) },
    { name: 'generate_analysis',   description: 'Generate / run the analysis report',          params: {},                                                   handler: () => dispatch('aq:analysis:generate', {}) },
    { name: 'toggle_quantum',      description: 'Enable or disable quantum probability mode',  params: { mode: 'on|off' },                                   handler: (p) => dispatch('aq:analysis:quantum', { mode: p?.mode || 'on' }) },
    { name: 'download_analysis',   description: 'Download the analysis as a DOCX file',       params: {},                                                   handler: () => dispatch('aq:analysis:download', {}) },
    { name: 'reset_analysis',      description: 'Reset / clear the current analysis',         params: {},                                                   handler: () => dispatch('aq:analysis:reset', {}) },
  ];
}
