/**
 * managed-switch-port-card  v1.0.0
 * Companion detail card for managed-switch-card.
 * Shows live port stats when a port is selected via input_select.
 * Supports any number of ports and both switches simultaneously.
 *
 * Layout (mirrors screenshot):
 *  ┌─────────────────────┬──────────────────┬──────────────────┐
 *  │  Velocità           │  Ultimi Dati     │  Totale Dati     │
 *  │  Grafico RX/TX      │  I/O · RX · TX   │  RX · TX switch  │
 *  └─────────────────────┴──────────────────┴──────────────────┘
 *
 * License: MIT
 */

const PORT_CARD_DEFAULTS = {
  // Which input_selects to watch — the card uses whichever one is not "Nessuna"
  // List them all; first non-"Nessuna" wins.
  input_selects: [],            // REQUIRED  ['input_select.port_selector_sw1', ...]

  // Per-switch configuration keyed by input_select entity_id
  // Each entry describes how to build entity names for that switch
  switches: {},
  // switches:
  //   'input_select.port_selector_sw1':
  //     sensor_base: 'sensor.myswitch1_192_168_1_1'
  //     binary_base: 'binary_sensor.myswitch1_192_168_1_1'
  //     ports: 8
  //     # suffix overrides (all optional — same defaults as managed-switch-card)
  //     suffix_status:   '_port_{N}_status'
  //     suffix_speed:    '_port_{N}_link_speed'
  //     suffix_port_io:  '_port_{N}_io'           ← velocity sensor per port
  //     suffix_port_rx:  '_port_{N}_traffic_received'
  //     suffix_port_tx:  '_port_{N}_traffic_sent'
  //     suffix_io:       '_switch_io'
  //     suffix_rx:       '_switch_traffic_received'
  //     suffix_tx:       '_switch_traffic_sent'
  //     io_entity:       ''   # override full entity for switch totals
  //     rx_entity:       ''
  //     tx_entity:       ''
  //     # speed tiers (same format as managed-switch-card)
  //     speed_tiers:     [...]
  //     # custom port labels
  //     port_labels:     {}

  // Visibility
  none_option: 'Nessuna',        // value in input_select that means "no port selected"
  option_prefix: 'Porta ',       // prefix of the option value, e.g. "Porta 1" → port 1

  // Graph
  history_hours: 1,              // how many hours of history to show in the chart
  graph_update_ms: 5000,         // how often to re-fetch history (ms)

  // Colors
  color_bg:          '#1a1a1a',
  color_card_bg:     '#111',
  color_border:      '#2a2a2a',
  color_text:        '#ffffff',
  color_accent:      '#4a90e2',
  color_sep:         '#333',
  color_rx:          '#ff9900',   // RX line color (orange like original)
  color_tx:          '#4a90e2',   // TX line color (blue like original)
  color_subtext:     '#888',
};

// ─── Suffix defaults for each switch config entry ─────────────────────────────
const SW_SUFFIX_DEFAULTS = {
  suffix_status:   '_port_{N}_status',
  suffix_speed:    '_port_{N}_link_speed',
  suffix_port_io:  '_port_{N}_io',
  suffix_port_rx:  '_port_{N}_traffic_received',
  suffix_port_tx:  '_port_{N}_traffic_sent',
  suffix_io:       '_switch_io',
  suffix_rx:       '_switch_traffic_received',
  suffix_tx:       '_switch_traffic_sent',
  io_entity:       '',
  rx_entity:       '',
  tx_entity:       '',
  speed_tiers: [
    { match: ['10000','10g'],  color: '#00cfff', shadow: '0 0 6px #00cfff', label: '10G'  },
    { match: ['1000','1g'],    color: '#00ff41', shadow: '0 0 5px #00ff41', label: '1G'   },
    { match: ['100'],          color: '#ff9900', shadow: '0 0 5px #ff9900', label: '100'  },
    { match: ['10'],           color: '#ff4444', shadow: '0 0 5px #ff4444', label: '10'   },
  ],
  port_labels: {},
};

// ─────────────────────────────────────────────────────────────────────────────
class ManagedSwitchPortCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._history   = [];     // [{t, rx, tx}] sampled from HA history
    this._histTimer = null;
    this._activeSwitch = null;
    this._activePort   = null;
  }

  static getConfigElement() {
    return document.createElement('managed-switch-port-card-editor');
  }
  static getStubConfig() {
    return {
      input_selects: ['input_select.port_selector_sw1', 'input_select.port_selector_sw2'],
      switches: {
        'input_select.port_selector_sw1': {
          sensor_base: 'sensor.myswitch1_192_168_1_1',
          binary_base: 'binary_sensor.myswitch1_192_168_1_1',
          ports: 8,
        },
        'input_select.port_selector_sw2': {
          sensor_base: 'sensor.myswitch2_192_168_1_2',
          binary_base: 'binary_sensor.myswitch2_192_168_1_2',
          ports: 24,
        },
      },
    };
  }

  // ── Config ────────────────────────────────────────────────────────────────
  setConfig(config) {
    if (!config.input_selects?.length) throw new Error('managed-switch-port-card: "input_selects" è obbligatorio.');
    if (!config.switches || !Object.keys(config.switches).length) throw new Error('managed-switch-port-card: "switches" è obbligatorio.');

    this._config = { ...PORT_CARD_DEFAULTS, ...config };

    // Normalise each switch entry with suffix defaults
    for (const [key, sw] of Object.entries(this._config.switches)) {
      this._config.switches[key] = { ...SW_SUFFIX_DEFAULTS, ...sw };
    }
  }

  // ── HASS ──────────────────────────────────────────────────────────────────
  set hass(hass) {
    this._hass = hass;
    this._resolveActive();
    this.render();
  }

  disconnectedCallback() {
    this._clearHistTimer();
  }

  // ── Resolve which switch + port is active ─────────────────────────────────
  _resolveActive() {
    const cfg = this._config;
    const s   = this._hass?.states;
    if (!s) { this._activeSwitch = null; this._activePort = null; return; }

    for (const selId of cfg.input_selects) {
      const val = s[selId]?.state;
      if (val && val !== cfg.none_option && val.startsWith(cfg.option_prefix)) {
        const portNum = parseInt(val.replace(cfg.option_prefix, '').trim(), 10);
        if (!isNaN(portNum)) {
          const sw = cfg.switches[selId];
          if (sw) {
            const changed = this._activeSwitch !== selId || this._activePort !== portNum;
            this._activeSwitch = selId;
            this._activePort   = portNum;
            if (changed) {
              // Port changed — reset history and restart timer
              this._history = [];
              this._restartHistTimer();
            }
            return;
          }
        }
      }
    }
    // Nothing active
    this._activeSwitch = null;
    this._activePort   = null;
    this._clearHistTimer();
  }

  // ── History timer ─────────────────────────────────────────────────────────
  _clearHistTimer() {
    if (this._histTimer) { clearInterval(this._histTimer); this._histTimer = null; }
  }

  _restartHistTimer() {
    this._clearHistTimer();
    this._fetchHistory();
    this._histTimer = setInterval(() => this._fetchHistory(), this._config.graph_update_ms);
  }

  async _fetchHistory() {
    if (!this._activeSwitch || !this._activePort || !this._hass) return;
    const sw     = this._config.switches[this._activeSwitch];
    const port   = this._activePort;
    const ioEnt  = sw.sensor_base + sw.suffix_port_io.replace('{N}', port);
    const rxEnt  = sw.sensor_base + sw.suffix_port_rx.replace('{N}', port);
    const hours  = this._config.history_hours;
    const start  = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    try {
      // Use HA history/recorder websocket API
      const results = await this._hass.callWS({
        type: 'history/history_during_period',
        start_time: start,
        entity_ids: [ioEnt, rxEnt],
        no_attributes: true,
        minimal_response: true,
      });

      const ioStates  = results[ioEnt]  || [];
      const rxStates  = results[rxEnt]  || [];

      // Build chart dataset: align by timestamp, prefer io (speed) for velocity
      // and rx for cumulative. We sample up to 60 points max.
      const pts = ioStates.map(pt => ({
        t:  new Date(pt.lu * 1000),
        io: parseFloat(pt.s) || 0,
      }));

      this._history = pts.slice(-60);
      this._renderChart();
    } catch (e) {
      // History not available — silently skip chart
      this._history = [];
      this._renderChart();
    }
  }

  // ── Speed tier matching ───────────────────────────────────────────────────
  _matchSpeed(sw, speedState) {
    const s = (speedState || '').toLowerCase();
    for (const tier of sw.speed_tiers) {
      const matches = Array.isArray(tier.match) ? tier.match : [tier.match];
      if (matches.some(m => s.includes(m.toLowerCase()))) return tier;
    }
    return null;
  }

  // ── Chart rendering (canvas) ──────────────────────────────────────────────
  _renderChart() {
    const canvas = this.shadowRoot.querySelector('#speed-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const pts = this._history;
    if (!pts.length) {
      ctx.fillStyle = '#333';
      ctx.font = '11px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('In attesa di dati...', W / 2, H / 2);
      return;
    }

    const values = pts.map(p => p.io);
    const maxVal = Math.max(...values, 0.01);

    const padL = 8, padR = 8, padT = 8, padB = 8;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const xOf = i => padL + (i / (pts.length - 1 || 1)) * chartW;
    const yOf = v => padT + chartH - (v / maxVal) * chartH;

    // Fill area
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(values[0]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(xOf(i), yOf(values[i]));
    ctx.lineTo(xOf(pts.length - 1), padT + chartH);
    ctx.lineTo(xOf(0), padT + chartH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
    grad.addColorStop(0, this._config.color_rx + '88');
    grad.addColorStop(1, this._config.color_rx + '00');
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(values[0]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(xOf(i), yOf(values[i]));
    ctx.strokeStyle = this._config.color_rx;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // ── Main render ───────────────────────────────────────────────────────────
  render() {
    const cfg = this._config;
    const s   = this._hass?.states;

    // Nothing selected → render empty/hidden state
    if (!this._activeSwitch || !this._activePort) {
      this.shadowRoot.innerHTML = '';
      return;
    }

    const sw     = cfg.switches[this._activeSwitch];
    const port   = this._activePort;
    const base   = sw.sensor_base;
    const bBase  = sw.binary_base;

    // Port entities
    const statusEnt = bBase + sw.suffix_status.replace('{N}', port);
    const speedEnt  = base  + sw.suffix_speed.replace('{N}', port);
    const ioEnt     = base  + sw.suffix_port_io.replace('{N}', port);
    const portRxEnt = base  + sw.suffix_port_rx.replace('{N}', port);
    const portTxEnt = base  + sw.suffix_port_tx.replace('{N}', port);

    // Switch-level traffic totals
    const swIoEnt = sw.io_entity || base + sw.suffix_io;
    const swRxEnt = sw.rx_entity || base + sw.suffix_rx;
    const swTxEnt = sw.tx_entity || base + sw.suffix_tx;

    const status = s?.[statusEnt]?.state;
    const speed  = s?.[speedEnt]?.state  || '';
    const io     = s?.[ioEnt]?.state     || '—';
    const portRx = s?.[portRxEnt]?.state || '—';
    const portTx = s?.[portTxEnt]?.state || '—';
    const swRx   = s?.[swRxEnt]?.state   || '—';
    const swTx   = s?.[swTxEnt]?.state   || '—';

    const isActive  = status === 'on';
    const tier      = isActive ? this._matchSpeed(sw, speed) : null;
    const ledColor  = tier ? tier.color  : '#333';
    const ledShadow = tier ? tier.shadow : 'none';
    const speedLabel = tier ? tier.label : (isActive ? speed : '—');
    const customLabel = sw.port_labels?.[String(port)] || '';
    const portName = customLabel ? `Porta ${port} — ${customLabel}` : `Porta ${port}`;

    // Parse io value for display
    const ioNum   = parseFloat(io);
    const ioDisp  = isNaN(ioNum) ? io : ioNum.toFixed(2);

    const css = `
      :host { display: block; }
      .pc-wrap {
        background: transparent;
        font-family: Arial, sans-serif;
        color: ${cfg.color_text};
        -webkit-text-size-adjust: 100%;
      }
      /* ── Title bar ── */
      .pc-title {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
        font-size: 12px;
        color: ${cfg.color_subtext};
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .pc-title-led {
        width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
      }
      .pc-title-speed {
        background: rgba(255,255,255,0.06);
        padding: 2px 7px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: bold;
        color: ${tier ? tier.color : cfg.color_subtext};
        margin-left: auto;
      }
      /* ── 3-column grid ── */
      .pc-grid {
        display: grid;
        grid-template-columns: 1.6fr 1fr 1fr;
        gap: 10px;
      }
      .pc-panel {
        background: ${cfg.color_card_bg};
        border: 1px solid ${cfg.color_border};
        border-radius: 10px;
        padding: 14px 16px;
      }
      .pc-panel-title {
        font-size: 13px;
        font-weight: bold;
        color: ${cfg.color_text};
        margin-bottom: 12px;
      }
      /* ── Velocity panel ── */
      .vel-numbers {
        display: flex;
        align-items: baseline;
        gap: 18px;
        margin-bottom: 4px;
      }
      .vel-big {
        font-size: 28px;
        font-weight: 300;
        color: ${cfg.color_text};
        line-height: 1;
      }
      .vel-unit {
        font-size: 13px;
        color: ${cfg.color_subtext};
        margin-left: 2px;
      }
      .vel-legend {
        display: flex;
        gap: 14px;
        margin-bottom: 10px;
        font-size: 11px;
      }
      .vel-legend-item { display: flex; align-items: center; gap: 5px; color: ${cfg.color_subtext}; }
      .vel-legend-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
      canvas { width: 100%; height: 70px; display: block; border-radius: 4px; }
      /* ── Data rows ── */
      .data-cols {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px;
        text-align: center;
      }
      .data-cols-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        text-align: center;
      }
      .dc-head {
        font-size: 11px;
        color: ${cfg.color_subtext};
        margin-bottom: 10px;
        font-weight: bold;
      }
      .dc-icon {
        font-size: 18px;
        margin: 6px 0 4px;
        color: ${cfg.color_accent};
        display: block;
      }
      .dc-val {
        font-size: 13px;
        font-weight: bold;
        color: ${cfg.color_text};
      }
      .dc-unit {
        font-size: 10px;
        color: ${cfg.color_subtext};
      }
      .sep-v {
        width: 1px;
        background: ${cfg.color_sep};
        margin: 0 2px;
        align-self: stretch;
      }
      .data-row-wrap {
        display: flex;
        align-items: stretch;
      }
    `;

    // We need canvas to be real DOM, so we build innerHTML first then draw
    this.shadowRoot.innerHTML = `
      <style>${css}</style>
      <div class="pc-wrap">
        <div class="pc-title">
          <div class="pc-title-led" style="background:${ledColor};box-shadow:${ledShadow}"></div>
          Stato Porta ${port}
          <div class="pc-title-speed">${speedLabel}</div>
        </div>

        <div class="pc-grid">

          <!-- PANEL 1: Velocità di Trasferimento -->
          <div class="pc-panel">
            <div class="pc-panel-title">Velocità di Trasferimento
              <span style="float:right;font-size:18px;color:${cfg.color_accent};font-weight:normal;cursor:default" title="Velocità I/O porta">⇄</span>
            </div>
            <div class="vel-numbers">
              <span>
                <span class="vel-big">${ioDisp}</span>
                <span class="vel-unit">MB/s</span>
              </span>
            </div>
            <div class="vel-legend">
              <div class="vel-legend-item">
                <div class="vel-legend-dot" style="background:${cfg.color_rx}"></div> I/O Porta
              </div>
            </div>
            <canvas id="speed-chart" width="400" height="70"></canvas>
          </div>

          <!-- PANEL 2: Ultimi Dati Rilevati -->
          <div class="pc-panel">
            <div class="pc-panel-title">Ultimi Dati Rilevati</div>
            <div class="data-row-wrap">
              <div class="data-cols" style="flex:1">
                <div>
                  <div class="dc-head">Porta ${port} I/O</div>
                  <span class="dc-icon">↕</span>
                  <div class="dc-val">${ioDisp}</div>
                  <div class="dc-unit">MB/s</div>
                </div>
                <div>
                  <div class="dc-head">Ricevuto</div>
                  <span class="dc-icon" style="color:${cfg.color_rx}">⬇</span>
                  <div class="dc-val">${portRx}</div>
                  <div class="dc-unit">MB</div>
                </div>
                <div>
                  <div class="dc-head">Inviato</div>
                  <span class="dc-icon" style="color:${cfg.color_tx}">⬆</span>
                  <div class="dc-val">${portTx}</div>
                  <div class="dc-unit">MB</div>
                </div>
              </div>
            </div>
          </div>

          <!-- PANEL 3: Totale Dati Trasmessi -->
          <div class="pc-panel">
            <div class="pc-panel-title">Totale Dati Trasmessi</div>
            <div class="data-row-wrap">
              <div class="data-cols-2" style="flex:1">
                <div>
                  <div class="dc-head">Ricevuti</div>
                  <span class="dc-icon" style="color:${cfg.color_rx}">⬇</span>
                  <div class="dc-val">${swRx}</div>
                  <div class="dc-unit">MB</div>
                </div>
                <div>
                  <div class="dc-head">Inviati</div>
                  <span class="dc-icon" style="color:${cfg.color_tx}">⬆</span>
                  <div class="dc-val">${swTx}</div>
                  <div class="dc-unit">MB</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>`;

    // Draw chart after DOM is ready
    requestAnimationFrame(() => {
      const canvas = this.shadowRoot.querySelector('#speed-chart');
      if (canvas) {
        // Set real pixel size from rendered size
        const rect = canvas.getBoundingClientRect();
        if (rect.width > 0) {
          canvas.width  = rect.width  * (window.devicePixelRatio || 1);
          canvas.height = rect.height * (window.devicePixelRatio || 1);
          const ctx = canvas.getContext('2d');
          ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
        }
        this._renderChart();
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  VISUAL EDITOR
// ─────────────────────────────────────────────────────────────────────────────
class ManagedSwitchPortCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...PORT_CARD_DEFAULTS, ...config };
    this._render();
  }
  set hass(h) { this._hass = h; }

  _fire(cfg) {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: cfg }, bubbles: true, composed: true,
    }));
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const cfg = this._config;

    // Build per-switch fields
    const switchKeys = Object.keys(cfg.switches || {});
    const swFields = switchKeys.map(key => {
      const sw = cfg.switches[key];
      return `
        <div class="sw-block">
          <div class="sw-title">Switch: <code>${key}</code></div>
          ${this._swField(key, 'sensor_base',    'Sensor base',          sw.sensor_base)}
          ${this._swField(key, 'binary_base',    'Binary sensor base',   sw.binary_base)}
          ${this._swField(key, 'ports',          'Numero porte',         sw.ports, 'number')}
          ${this._swField(key, 'suffix_port_io', 'Suffisso I/O porta',   sw.suffix_port_io, 'text', 'es. _port_{N}_io')}
          ${this._swField(key, 'suffix_port_rx', 'Suffisso RX porta',    sw.suffix_port_rx)}
          ${this._swField(key, 'suffix_port_tx', 'Suffisso TX porta',    sw.suffix_port_tx)}
          ${this._swField(key, 'suffix_rx',      'Suffisso RX switch',   sw.suffix_rx)}
          ${this._swField(key, 'suffix_tx',      'Suffisso TX switch',   sw.suffix_tx)}
          ${this._swField(key, 'io_entity',      'Override entità I/O switch', sw.io_entity, 'text', 'lascia vuoto per usare sensor_base+suffix')}
          ${this._swField(key, 'rx_entity',      'Override entità RX switch',  sw.rx_entity)}
          ${this._swField(key, 'tx_entity',      'Override entità TX switch',  sw.tx_entity)}
        </div>`;
    }).join('');

    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;padding:16px;font-family:Arial,sans-serif;font-size:13px}
        h4{margin:16px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#4a90e2;border-top:1px solid #333;padding-top:12px}
        h4:first-child{border-top:none;margin-top:0}
        .row{margin-bottom:10px}
        label{display:block;font-size:11px;color:#888;margin-bottom:3px}
        input,select{width:100%;padding:5px 8px;border-radius:5px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:13px;box-sizing:border-box}
        small{display:block;font-size:10px;color:#555;margin-top:2px}
        .sw-block{border:1px solid #333;border-radius:8px;padding:12px;margin-bottom:12px}
        .sw-title{font-size:11px;color:#4a90e2;font-weight:bold;margin-bottom:10px}
        code{background:#222;padding:1px 5px;border-radius:3px;font-size:10px}
      </style>
      <h4>Input Selects</h4>
      <div class="row">
        <label>Entity IDs (uno per riga)</label>
        <textarea rows="3" data-key="input_selects_raw"
          style="width:100%;padding:5px 8px;border-radius:5px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:12px;box-sizing:border-box;resize:vertical"
          onchange="this.getRootNode().host._change(event)">${(cfg.input_selects||[]).join('\n')}</textarea>
      </div>

      <h4>Configurazione Switch</h4>
      ${swFields}

      <h4>Grafico</h4>
      <div class="row">
        <label>Ore di storico</label>
        <input type="number" value="${cfg.history_hours}" data-key="history_hours" onchange="this.getRootNode().host._change(event)"/>
      </div>
      <div class="row">
        <label>Aggiornamento grafico (ms)</label>
        <input type="number" value="${cfg.graph_update_ms}" data-key="graph_update_ms" onchange="this.getRootNode().host._change(event)"/>
      </div>

      <h4>Colori</h4>
      <div class="row"><label>Sfondo card</label><input type="color" value="${cfg.color_card_bg}" data-key="color_card_bg" onchange="this.getRootNode().host._change(event)"/></div>
      <div class="row"><label>Colore linea RX/I/O</label><input type="color" value="${cfg.color_rx}" data-key="color_rx" onchange="this.getRootNode().host._change(event)"/></div>
      <div class="row"><label>Colore linea TX</label><input type="color" value="${cfg.color_tx}" data-key="color_tx" onchange="this.getRootNode().host._change(event)"/></div>
      <div class="row"><label>Accento</label><input type="color" value="${cfg.color_accent}" data-key="color_accent" onchange="this.getRootNode().host._change(event)"/></div>
    `;
  }

  _swField(swKey, field, label, value, type='text', hint='') {
    return `
      <div class="row">
        <label>${label}</label>
        <input type="${type}" value="${value ?? ''}"
          data-swkey="${swKey}" data-field="${field}"
          onchange="this.getRootNode().host._changeSw(event)"/>
        ${hint ? `<small>${hint}</small>` : ''}
      </div>`;
  }

  _change(e) {
    const key = e.target.dataset.key;
    let val = e.target.value;
    let cfg = { ...this._config };
    if (key === 'input_selects_raw') {
      cfg.input_selects = val.split('\n').map(v => v.trim()).filter(Boolean);
      this._fire(cfg); return;
    }
    if (key === 'history_hours')  { cfg.history_hours  = parseFloat(val) || 1; this._fire(cfg); return; }
    if (key === 'graph_update_ms'){ cfg.graph_update_ms = parseInt(val, 10) || 5000; this._fire(cfg); return; }
    cfg[key] = val;
    this._fire(cfg);
  }

  _changeSw(e) {
    const swKey = e.target.dataset.swkey;
    const field = e.target.dataset.field;
    let val = e.target.value;
    if (field === 'ports') val = parseInt(val, 10) || 8;
    const cfg = { ...this._config };
    cfg.switches = { ...cfg.switches };
    cfg.switches[swKey] = { ...cfg.switches[swKey], [field]: val };
    this._fire(cfg);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
customElements.define('managed-switch-port-card', ManagedSwitchPortCard);
customElements.define('managed-switch-port-card-editor', ManagedSwitchPortCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type:             'managed-switch-port-card',
  name:             'Managed Switch Port Card',
  description:      'Card dettaglio porta per managed-switch-card. Mostra velocità I/O, grafico storico, dati per porta e totali switch.',
  preview:          false,
  documentationURL: 'https://github.com/YOUR_USERNAME/managed-switch-card',
});
