/* 🧩 ATHENA WIDGETS — entry point. Registers window.AthenaUI.

   Two jobs: (1) at boot, apply every LIVE widget/theme to the running game
   (slots, selectors, themes — widgets.runtime.js); (2) on demand, open the
   Widget Designer (widgets.editor.js), the UMG-style tool where the admin
   builds widgets and event graphs and restyles existing screens.

   Reads the legacy app only through window.MythicBridge (signedIn, cloud,
   toast, confirm, isAdmin, and `ui` — the data/actions hand-over for
   bindings). With no bridge at all it still runs: local-only saving, empty
   data. Never touches Profile/Cloud/App directly (the globals trap). */

import { openDesigner, closeDesigner, isOpen, current } from './widgets.editor.js';
import { boot, reload, mount, render, applyTheme, registerSlotProvider, knownSlots, refreshAll, mountsInfo, liveDocs, sampleData, listActions } from './widgets.runtime.js';
import { newWidget, normalize, serialize, WIDGET_TYPES, GRAPH_NODES, interpolate, evalExpr, WIDGET_VERSION } from './widgets.format.js';
import * as api from './widgets.api.js';

const AthenaUI = {
  version: WIDGET_VERSION,
  openDesigner: (opts) => openDesigner(opts).catch(e => { try { console.warn('[widgets] designer failed', e); } catch (_) {} return null; }),
  closeDesigner, isOpen, designer: current,
  /* runtime */
  mount, render, applyTheme, reload, refresh: refreshAll, mounts: mountsInfo, live: liveDocs,
  /* a screen offers data + actions to widgets in its slots: AthenaUI.slots.register('farm.', { data(){…}, actions:{…}, slots:['farm.hud'] }) */
  slots: { register: registerSlotProvider, known: knownSlots },
  data: sampleData, actions: listActions,
  format: { newWidget, normalize, serialize, WIDGET_TYPES, GRAPH_NODES, interpolate, evalExpr },
  docs: { list: api.listAll, load: api.load, save: api.save, remove: api.remove, setLive: api.setLive, liveAll: api.liveAll },
};
try { window.AthenaUI = AthenaUI; } catch (e) {}

try {
  const start = () => { try { boot(); } catch (e) { try { console.warn('[widgets] boot failed', e); } catch (_) {} } };
  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(start, 0); else window.addEventListener('DOMContentLoaded', start, { once: true });
  const q = new URLSearchParams(location.search);
  if (q.get('widgets') === '1') { const go = () => setTimeout(() => AthenaUI.openDesigner(q.get('widget') ? { id: q.get('widget'), source: q.get('src') || 'local' } : {}), 900); if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true }); }
} catch (e) {}

export default AthenaUI;
