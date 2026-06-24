/**
 * managed-switch-card  v2.0.0
 * Universal Lovelace card for managed network switches in Home Assistant.
 * Works with any brand/model that exposes the right sensor entities.
 *
 * License: MIT
 */

// ─────────────────────────────────────────────────────────────────────────────
//  DEFAULTS — mirror the exact visual DNA of the originals
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULTS = {
  // Header
  title:           'SWITCH',
  model:           '',           // shown as "Modello: X" — omit to hide
  ports:           8,

  // Entity patterns  (placeholders replaced by sensor_base / binary_base)
  sensor_base:     '',           // REQUIRED  e.g. sensor.myswitch_192_168_1_1
  binary_base:     '',           // REQUIRED  e.g. binary_sensor.myswitch_192_168_1_1

  // Entity name suffixes — override if your integration uses different names
  suffix_ip:       '_ip_address',
  suffix_sn:       '_switch_serial_number',
  suffix_fw:       '_switch_firmware',
  suffix_boot:     '_switch_bootlader',   // set '' to hide BL line
  suffix_io:       '_switch_io',
  suffix_rx:       '_switch_traffic_received',
  suffix_tx:       '_switch_traffic_sent',
  suffix_status:   '_port_{N}_status',    // {N} → port number
  suffix_speed:    '_port_{N}_link_speed',
  suffix_port_rx:  '_port_{N}_traffic_received',
  suffix_port_tx:  '_port_{N}_traffic_sent',

  // Override full entity id for traffic stats (useful when your stats come
  // from a different device, like in the original switch-8 card)
  io_entity:       '',
  rx_entity:       '',
  tx_entity:       '',

  // input_select for port selection automations (optional)
  input_select:    '',
  input_select_option_prefix: 'Porta ',   // e.g. "Porta 1"
  input_select_none: 'Nessuna',

  // Reboot button (optional)
  reboot_button:   '',

  // Layout
  // 'auto'   → single row if ports ≤ 12, double (odd top / even bottom) if > 12
  // 'single' → all ports in one row
  // 'double' → always odd top / even bottom (original 24-port style)
  layout: 'auto',

  // Visual extras (all default to the originals — off)
  sfp_ports:    [],    // port numbers rendered as SFP (different visual)
  uplink_ports: [],    // port numbers get a small UPL badge
  port_labels:  {},    // { "1": "NAS", "5": "AP" } — replaces speed text

  // LED speed thresholds — fully customisable
  // Each entry: { match: string|string[], color, shadow, label }
  // Matched against the link_speed entity state (case-insensitive includes)
  speed_tiers: [
    { match: ['10000','10g'],  color: '#00cfff', shadow: '0 0 6px #00cfff', label: '10G'  },
    { match: ['1000','1g'],    color: '#00ff41', shadow: '0 0 5px #00ff41', label: '1G'   },
    { match: ['100'],          color: '#ff9900', shadow: '0 0 5px #ff9900', label: '100'  },
    { match: ['10'],           color: '#ff4444', shadow: '0 0 5px #ff4444', label: '10'   },
  ],

  // Colors — originals were hardcoded dark; expose them all
  color_bg:          '#1a1a1a',
  color_port_bg:     '#111',
  color_port_border: '#333',
  color_text:        '#ffffff',
  color_accent:      '#4a90e2',
  color_sep:         '#444',
  color_led_off:     '#222',
  color_footer_border:'#333',
  color_port_num:    '#888',

  // Feature flags
  show_reboot:   true,
  show_stats:    true,
  show_tooltip:  true,
};

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN CARD
// ─────────────────────────────────────────────────────────────────────────────
class ManagedSwitchCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._initialized = false;
    this._tooltip = null;
  }

  // Lovelace editor hook
  static getConfigElement() {
    return document.createElement('managed-switch-card-editor');
  }
  static getStubConfig() {
    return {
      title: 'SWITCH',
      model: 'MySwitch-8',
      ports: 8,
      sensor_base: 'sensor.myswitch_192_168_1_1',
      binary_base: 'binary_sensor.myswitch_192_168_1_1',
      input_select: 'input_select.port_selector',
      reboot_button: 'button.myswitch_reboot',
    };
  }

  // ── Config ────────────────────────────────────────────────────────────────
  setConfig(config) {
    if (!config.sensor_base) throw new Error('managed-switch-card: "sensor_base" è obbligatorio.');
    if (!config.binary_base) throw new Error('managed-switch-card: "binary_base" è obbligatorio.');
    this._config = { ...DEFAULTS, ...config };
    this._config.ports = parseInt(this._config.ports, 10) || 8;
    // Normalise speed_tiers: allow user to extend or replace
    if (!config.speed_tiers) this._config.speed_tiers = DEFAULTS.speed_tiers;
  }

  // ── HASS ─────────────────────────────────────────────────────────────────
  set hass(hass) {
    this._hass = hass;
    if (!this._initialized) {
      // First time hass arrives: honour any pending reset from connectedCallback
      this.selectedItem = null;
      this._initialized = true;
      // If connectedCallback fired before hass was ready, flush the deferred reset now
      if (this._pendingReset) {
        this._pendingReset = false;
        if (this._config?.input_select) {
          this._hass.callService('input_select', 'select_option', {
            entity_id: this._config.input_select,
            option: this._config.input_select_none,
          });
        }
      }
    }
    this.render();
  }

  connectedCallback() {
    // Called every time the card is mounted — including dashboard switches.
    // Must always reset selection, regardless of whether _hass is ready yet.
    this.selectedItem = null;
    if (this._hass && this._config?.input_select) {
      // hass already available: reset server-side immediately
      this._hass.callService('input_select', 'select_option', {
        entity_id: this._config.input_select,
        option: this._config.input_select_none,
      });
    } else {
      // hass not yet available (first mount or remount before hass setter fires):
      // flag it so the hass setter will flush it when it arrives
      this._pendingReset = true;
    }
    // Re-render to clear any stale selected state from the previous session
    // (render guards against missing _hass, so this is safe)
    this.render();
  }

  disconnectedCallback() {
    // Card is being unmounted (dashboard change, card removal, etc.)
    // Clean up tooltip if left hanging
    if (this._tooltip) { this._tooltip.remove(); this._tooltip = null; }
    // Reset selection state so next connectedCallback starts clean
    this.selectedItem = null;
  }

  // ── Entity helpers ────────────────────────────────────────────────────────
  _state(entityId) {
    return this._hass.states?.[entityId]?.state ?? 'N/A';
  }

  _portEntity(suffix_key, portNum) {
    const cfg = this._config;
    const suffix = cfg[suffix_key].replace('{N}', portNum);
    return cfg.sensor_base + suffix;
  }

  _binaryPortEntity(suffix_key, portNum) {
    const cfg = this._config;
    const suffix = cfg[suffix_key].replace('{N}', portNum);
    return cfg.binary_base + suffix;
  }

  // ── Speed tier matching (original logic + extensible) ─────────────────────
  _matchSpeed(speedState) {
    const s = (speedState || '').toLowerCase();
    for (const tier of this._config.speed_tiers) {
      const matches = Array.isArray(tier.match) ? tier.match : [tier.match];
      if (matches.some(m => s.includes(m.toLowerCase()))) return tier;
    }
    return null;
  }

  // ── Port HTML (faithful to originals) ────────────────────────────────────
  _renderPort(i) {
    const cfg = this._config;
    const s = this._hass.states;

    const isSelected  = this.selectedItem === 'port-' + i;
    const isSFP       = cfg.sfp_ports.includes(i);
    const isUplink    = cfg.uplink_ports.includes(i);
    const customLabel = cfg.port_labels[String(i)] || '';

    const statusEntity = this._binaryPortEntity('suffix_status', i);
    const speedEntity  = this._portEntity('suffix_speed', i);
    const status = s[statusEntity]?.state;
    const speed  = s[speedEntity]?.state || '';

    // Exact original defaults
    let ledColor  = cfg.color_led_off;  // '#222'
    let speedText = '-';
    let shadow    = 'none';
    let active    = false;

    if (status === 'on') {
      active = true;
      const tier = this._matchSpeed(speed);
      if (tier) {
        ledColor  = tier.color;
        shadow    = tier.shadow;
        speedText = tier.label;
      } else {
        // Fallback: active but unknown speed
        ledColor  = '#888';
        speedText = '?';
        shadow    = 'none';
      }
    }

    // Port RX/TX for tooltip
    const portRxEnt = this._portEntity('suffix_port_rx', i);
    const portTxEnt = this._portEntity('suffix_port_tx', i);
    const portRx = s[portRxEnt]?.state ?? null;
    const portTx = s[portTxEnt]?.state ?? null;

    // Tooltip data (only built if enabled)
    const tooltipAttr = cfg.show_tooltip
      ? `data-tip="${i}|${speed}|${portRx}|${portTx}|${status}|${customLabel}"`
      : '';

    // SFP gets a slightly taller/darker bay to differentiate (additive, not replacing)
    const sfpClass  = isSFP     ? ' sfp'    : '';
    const uplBadge  = isUplink  ? `<div class="port-badge upl">UPL</div>` : '';
    const sfpBadge  = isSFP     ? `<div class="port-badge sfp">SFP</div>` : '';

    const displayLabel = customLabel || speedText;

    return `
      <div class="bay-container${active ? ' active' : ''}"
           onclick="this.getRootNode().host._onPortClick(${i})"
           onmouseenter="this.getRootNode().host._onPortEnter(event, this)"
           onmouseleave="this.getRootNode().host._onPortLeave()"
           ${tooltipAttr}>
        ${sfpBadge}${uplBadge}
        <div class="port-num">${i}</div>
        <div class="bay-handle${isSelected ? ' selected' : ''}${sfpClass}">
          <div class="bay-led" style="background:${ledColor};box-shadow:${shadow}"></div>
        </div>
        <div class="speed-label">${displayLabel}</div>
      </div>`;
  }

  // ── Grid layout ───────────────────────────────────────────────────────────
  _buildGrid() {
    const cfg = this._config;
    const n   = cfg.ports;
    const layout = cfg.layout === 'auto' ? (n > 12 ? 'double' : 'single') : cfg.layout;

    if (layout === 'single') {
      let html = '';
      for (let i = 1; i <= n; i++) html += this._renderPort(i);
      // gap:8px matches original switch-8 style
      return `<div class="port-row" style="grid-template-columns:repeat(${n},1fr);gap:8px;margin-bottom:20px">${html}</div>`;
    }

    // double: odd ports top row, even ports bottom row — original switch-24 style
    // grid-template-columns: repeat(12, 1fr) in the original for 24 ports
    // For other port counts: repeat(ceil(n/2), 1fr)
    const cols = n === 24 ? 12 : Math.ceil(n / 2);
    let topHtml = '', botHtml = '';
    for (let i = 1; i <= n; i += 2) topHtml += this._renderPort(i);
    for (let i = 2; i <= n; i += 2) botHtml  += this._renderPort(i);
    return `
      <div class="grid-container">
        <div class="port-row" style="grid-template-columns:repeat(${cols},1fr);gap:4px">${topHtml}</div>
        <div class="port-row" style="grid-template-columns:repeat(${cols},1fr);gap:4px">${botHtml}</div>
      </div>`;
  }

  // ── Main render ───────────────────────────────────────────────────────────
  render() {
    if (!this._hass || !this._config) return;
    const cfg = this._config;
    const s   = this._hass.states;

    // Header info
    const ip   = s[cfg.sensor_base + cfg.suffix_ip]?.state   || 'N/A';
    const sn   = s[cfg.sensor_base + cfg.suffix_sn]?.state   || 'N/A';
    const fw   = s[cfg.sensor_base + cfg.suffix_fw]?.state   || 'N/A';
    const boot = cfg.suffix_boot
      ? (s[cfg.sensor_base + cfg.suffix_boot]?.state || 'N/A')
      : null;

    // Traffic stats — prefer explicit override entities, else build from sensor_base
    const ioEnt = cfg.io_entity || cfg.sensor_base + cfg.suffix_io;
    const rxEnt = cfg.rx_entity || cfg.sensor_base + cfg.suffix_rx;
    const txEnt = cfg.tx_entity || cfg.sensor_base + cfg.suffix_tx;
    const io = s[ioEnt]?.state || 'N/A';
    const rx = s[rxEnt]?.state || 'N/A';
    const tx = s[txEnt]?.state || 'N/A';

    // Count active ports
    let activeCount = 0;
    for (let i = 1; i <= cfg.ports; i++) {
      const ent = cfg.binary_base + cfg.suffix_status.replace('{N}', i);
      if (s[ent]?.state === 'on') activeCount++;
    }

    // ── Subtitle lines (mirrors originals exactly) ────────────────────────
    const modelPart = cfg.model ? `Modello: ${cfg.model} <span class="sep">|</span> ` : '';
    const bootPart  = boot !== null ? ` <span class="sep">|</span> BL: ${boot}` : '';

    const subtitleHtml = `
      <div>${modelPart}IP: ${ip}</div>
      <div>SN: ${sn} <span class="sep">|</span> FW: ${fw}${bootPart}</div>`;

    // ── Reboot button (only if configured and show_reboot) ────────────────
    const rebootHtml = (cfg.show_reboot && cfg.reboot_button)
      ? `<ha-icon class="btn-reboot" icon="mdi:restart" onclick="this.getRootNode().host._onReboot()"></ha-icon>`
      : '';

    // ── Stats footer ──────────────────────────────────────────────────────
    const statsHtml = cfg.show_stats ? `
      <div class="footer-stats">
        Ultimi dati generali rilevati
        <span class="sep">|</span> I/O: ${io} MB/s
        <span class="sep">|</span> Ricevuti: ${rx} MB
        <span class="sep">|</span> Inviati: ${tx} MB
      </div>` : '';

    // ── CSS (pixel-perfect to originals, with cfg color tokens) ──────────
    const css = `
      ha-card {
        background: ${cfg.color_bg};
        color: ${cfg.color_text};
        padding: 20px;
        border-radius: 12px;
        font-family: Arial, sans-serif;
        -webkit-text-size-adjust: 100%;
        position: relative;
      }
      .header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 25px;
        width: 100%;
      }
      .brand { flex-grow: 1; min-width: 0; }
      .brand-container { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
      .logo { font-weight: 800; font-size: 20px; text-transform: uppercase; letter-spacing: 1px; }
      .subtitle, .footer-stats {
        color: ${cfg.color_accent};
        font-size: 11px;
        font-weight: bold;
        opacity: 0.9;
        line-height: 1.4;
      }
      .sep { color: ${cfg.color_sep}; margin: 0 6px; font-weight: normal; }
      .active-count {
        color: #00ff41;
        font-weight: bold;
        font-size: 13px;
        text-transform: uppercase;
        padding: 4px 10px;
        border: 2px solid #00ff41;
        border-radius: 6px;
        box-shadow: 0 0 8px rgba(0,255,65,0.4);
        white-space: nowrap;
        flex-shrink: 0;
      }
      .btn-reboot {
        color: ${cfg.color_accent};
        cursor: pointer;
        --mdc-icon-size: 24px;
        transition: 0.2s;
      }
      .btn-reboot:hover { color: #ff4100; }

      /* ── Port grid ─────────────────────────────────────── */
      .grid-container { display: flex; flex-direction: column; gap: 15px; width: 100%; margin-bottom: 20px; }
      .port-row { display: grid; width: 100%; }

      /* ── Port bay ──────────────────────────────────────── */
      .bay-container { text-align: center; cursor: pointer; min-width: 0; position: relative; }
      .port-badge {
        font-size: 8px; font-weight: bold; padding: 1px 3px;
        border-radius: 3px; display: inline-block; margin-bottom: 2px;
        letter-spacing: 0.5px;
      }
      .port-badge.sfp { background: ${cfg.color_accent}; color: #fff; }
      .port-badge.upl { background: #ff9900; color: #000; }
      .port-num { font-size: 11px; color: ${cfg.color_port_num}; margin-bottom: 6px; font-weight: bold; }
      .bay-handle {
        height: 30px;
        width: 100%;
        max-width: 45px;
        background: ${cfg.color_port_bg};
        border: 2px solid ${cfg.color_port_border};
        border-radius: 4px;
        display: flex;
        justify-content: center;
        padding-top: 5px;
        box-sizing: border-box;
        transition: 0.2s;
        margin: 0 auto;
      }
      .bay-handle.selected {
        border-color: ${cfg.color_accent};
        box-shadow: 0 0 12px rgba(74,144,226,0.4);
      }
      .bay-handle.sfp {
        background: #0a0f14;
        border-radius: 3px;
      }
      .bay-led { width: 22px; height: 4px; border-radius: 1px; flex-shrink: 0; }
      .speed-label { font-size: 11px; color: ${cfg.color_accent}; margin-top: 6px; font-weight: bold; }

      /* ── Footer ────────────────────────────────────────── */
      .footer-stats { border-top: 1px solid ${cfg.color_footer_border}; padding-top: 15px; text-align: left; }

      /* ── Tooltip ───────────────────────────────────────── */
      .sw-tip {
        position: fixed; z-index: 9999;
        background: #2a2a2a; border: 1px solid #444;
        border-radius: 8px; padding: 10px 14px;
        font-size: 12px; color: #fff; pointer-events: none;
        min-width: 155px; box-shadow: 0 4px 18px rgba(0,0,0,0.4);
        line-height: 1.65; font-family: Arial, sans-serif;
      }
      .sw-tip .t-title { font-weight: bold; font-size: 13px; color: ${cfg.color_accent}; margin-bottom: 5px; }
      .sw-tip .t-row { display: flex; justify-content: space-between; gap: 10px; }
      .sw-tip .t-lbl { color: #888; }
      .sw-tip .t-val { font-weight: bold; }
    `;

    this.shadowRoot.innerHTML = `
      <style>${css}</style>
      <ha-card>
        <div class="header">
          <div class="brand">
            <div class="brand-container">
              <div class="logo">${cfg.title}</div>
              ${rebootHtml}
            </div>
            <div class="subtitle">${subtitleHtml}</div>
          </div>
          <div class="active-count">${activeCount}/${cfg.ports} Active</div>
        </div>

        ${this._buildGrid()}
        ${statsHtml}
      </ha-card>`;
  }

  // ── Event handlers ────────────────────────────────────────────────────────
  _onPortClick(i) {
    const key = 'port-' + i;
    // Toggle: click same port again → deselect (original behaviour)
    this.selectedItem = (this.selectedItem === key) ? null : key;
    if (this._config.input_select) {
      this._hass.callService('input_select', 'select_option', {
        entity_id: this._config.input_select,
        option: this.selectedItem
          ? this._config.input_select_option_prefix + i
          : this._config.input_select_none,
      });
    }
    this.render();
  }

  _onReboot() {
    if (confirm('Vuoi davvero riavviare lo switch?')) {
      this._hass.callService('button', 'press', {
        entity_id: this._config.reboot_button,
      });
    }
  }

  _onPortEnter(event, el) {
    if (!this._config.show_tooltip) return;
    const raw = el.getAttribute('data-tip');
    if (!raw) return;
    const [i, speed, portRx, portTx, status, customLabel] = raw.split('|');

    const existing = this.shadowRoot.querySelector('.sw-tip');
    if (existing) existing.remove();

    const statusHtml = status === 'on'
      ? `<span style="color:#00ff41">● Attiva</span>`
      : `<span style="color:#555">○ Inattiva</span>`;

    const nameRow = customLabel
      ? `<div class="t-title">Porta ${i} — ${customLabel}</div>`
      : `<div class="t-title">Porta ${i}</div>`;

    const rxRow = portRx && portRx !== 'null' && portRx !== 'N/A'
      ? `<div class="t-row"><span class="t-lbl">↓ RX</span><span class="t-val">${portRx} MB</span></div>` : '';
    const txRow = portTx && portTx !== 'null' && portTx !== 'N/A'
      ? `<div class="t-row"><span class="t-lbl">↑ TX</span><span class="t-val">${portTx} MB</span></div>` : '';

    const tip = document.createElement('div');
    tip.className = 'sw-tip';
    tip.innerHTML = `
      ${nameRow}
      <div class="t-row"><span class="t-lbl">Stato</span><span class="t-val">${statusHtml}</span></div>
      <div class="t-row"><span class="t-lbl">Velocità</span><span class="t-val">${speed || '—'}</span></div>
      ${rxRow}${txRow}`;

    this.shadowRoot.appendChild(tip);

    let x = event.clientX + 14;
    let y = event.clientY + 14;
    if (x + 175 > window.innerWidth)  x = event.clientX - 175;
    if (y + 120 > window.innerHeight) y = event.clientY - 120;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
    this._tooltip = tip;
  }

  _onPortLeave() {
    if (this._tooltip) { this._tooltip.remove(); this._tooltip = null; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  VISUAL EDITOR  (Lovelace UI config panel)
// ─────────────────────────────────────────────────────────────────────────────
class ManagedSwitchCardEditor extends HTMLElement {
  setConfig(config) { this._config = { ...DEFAULTS, ...config }; this._render(); }
  set hass(h) { this._hass = h; }

  _fire(cfg) {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: cfg }, bubbles: true, composed: true,
    }));
  }

  _field(label, key, type = 'text', hint = '') {
    const v = this._config?.[key] ?? '';
    return `
      <div class="row">
        <label>${label}</label>
        <input type="${type}" value="${v}" data-key="${key}" onchange="this.getRootNode().host._change(event)"/>
        ${hint ? `<small>${hint}</small>` : ''}
      </div>`;
  }

  _select(label, key, opts) {
    const cur = String(this._config?.[key] ?? opts[0].v);
    const options = opts.map(o => `<option value="${o.v}" ${cur===String(o.v)?'selected':''}>${o.l}</option>`).join('');
    return `
      <div class="row">
        <label>${label}</label>
        <select data-key="${key}" onchange="this.getRootNode().host._change(event)">${options}</select>
      </div>`;
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;padding:16px;font-family:Arial,sans-serif;font-size:13px}
        h4{margin:16px 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#4a90e2;border-top:1px solid #333;padding-top:12px}
        h4:first-child{border-top:none;margin-top:0}
        .row{margin-bottom:10px}
        label{display:block;font-size:11px;color:#888;margin-bottom:3px}
        input,select{width:100%;padding:5px 8px;border-radius:5px;border:1px solid #444;background:#1a1a1a;color:#fff;font-size:13px;box-sizing:border-box}
        small{display:block;font-size:10px;color:#555;margin-top:2px}
      </style>

      <h4>Switch</h4>
      ${this._field('Titolo card', 'title')}
      ${this._field('Marca / Modello (es. MySwitch-8)', 'model')}
      ${this._field('Numero porte', 'ports', 'number')}
      ${this._select('Layout porte', 'layout', [
        {v:'auto',   l:'Auto (≤12 → singola, >12 → doppia)'},
        {v:'single', l:'Riga singola'},
        {v:'double', l:'Doppia riga (dispari sopra / pari sotto)'},
      ])}

      <h4>Entità — obbligatorie</h4>
      ${this._field('Sensor base', 'sensor_base', 'text', 'es. sensor.myswitch_192_168_1_1')}
      ${this._field('Binary sensor base', 'binary_base', 'text', 'es. binary_sensor.myswitch_192_168_1_1')}

      <h4>Entità — opzionali</h4>
      ${this._field('Input select (selezione porta)', 'input_select', 'text', 'es. input_select.port_selector')}
      ${this._field('Pulsante reboot', 'reboot_button', 'text', 'es. button.myswitch_reboot')}
      ${this._field('Override entità I/O', 'io_entity', 'text', 'lascia vuoto per usare sensor_base + suffix')}
      ${this._field('Override entità RX', 'rx_entity', 'text')}
      ${this._field('Override entità TX', 'tx_entity', 'text')}

      <h4>Suffissi entità (avanzato)</h4>
      ${this._field('Suffisso IP',         'suffix_ip')}
      ${this._field('Suffisso SN',         'suffix_sn')}
      ${this._field('Suffisso FW',         'suffix_fw')}
      ${this._field('Suffisso Bootloader', 'suffix_boot', 'text', 'lascia vuoto per nascondere')}
      ${this._field('Suffisso I/O',        'suffix_io')}
      ${this._field('Suffisso RX globale', 'suffix_rx')}
      ${this._field('Suffisso TX globale', 'suffix_tx')}
      ${this._field('Suffisso status porta ({N}=numero)',  'suffix_status')}
      ${this._field('Suffisso speed porta ({N}=numero)',   'suffix_speed')}
      ${this._field('Suffisso RX porta ({N}=numero)',      'suffix_port_rx')}
      ${this._field('Suffisso TX porta ({N}=numero)',      'suffix_port_tx')}

      <h4>Porte speciali</h4>
      ${this._field('Porte SFP (numeri separati da virgola)', 'sfp_ports_raw', 'text', 'es. 25,26')}
      ${this._field('Porte Uplink (numeri separati da virgola)', 'uplink_ports_raw', 'text', 'es. 8')}
      ${this._field('Etichette porte (JSON)', 'port_labels_raw', 'text', 'es. {"1":"NAS","5":"AP"}')}

      <h4>Colori</h4>
      ${this._field('Sfondo card',           'color_bg',           'color')}
      ${this._field('Sfondo porta',          'color_port_bg',      'color')}
      ${this._field('Bordo porta',           'color_port_border',  'color')}
      ${this._field('Testo principale',      'color_text',         'color')}
      ${this._field('Accento (link, label)', 'color_accent',       'color')}
      ${this._field('Separatore',            'color_sep',          'color')}
      ${this._field('LED spento',            'color_led_off',      'color')}

      <h4>Funzionalità</h4>
      ${this._select('Mostra pulsante reboot', 'show_reboot',  [{v:true,l:'Sì'},{v:false,l:'No'}])}
      ${this._select('Mostra statistiche',     'show_stats',   [{v:true,l:'Sì'},{v:false,l:'No'}])}
      ${this._select('Tooltip hover porte',    'show_tooltip', [{v:true,l:'Sì'},{v:false,l:'No'}])}
    `;
  }

  _change(e) {
    const key = e.target.dataset.key;
    let val   = e.target.value;
    let cfg   = { ...this._config };

    // Type coercions
    if (key === 'ports') { cfg.ports = parseInt(val, 10) || 8; this._fire(cfg); return; }
    if (['show_reboot','show_stats','show_tooltip'].includes(key)) {
      cfg[key] = val === 'true'; this._fire(cfg); return;
    }
    if (key === 'sfp_ports_raw') {
      cfg.sfp_ports = val.split(',').map(v=>parseInt(v.trim(),10)).filter(Boolean);
      this._fire(cfg); return;
    }
    if (key === 'uplink_ports_raw') {
      cfg.uplink_ports = val.split(',').map(v=>parseInt(v.trim(),10)).filter(Boolean);
      this._fire(cfg); return;
    }
    if (key === 'port_labels_raw') {
      try { cfg.port_labels = JSON.parse(val); } catch {}
      this._fire(cfg); return;
    }
    cfg[key] = val;
    this._fire(cfg);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────
customElements.define('managed-switch-card', ManagedSwitchCard);
customElements.define('managed-switch-card-editor', ManagedSwitchCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type:             'managed-switch-card',
  name:             'Managed Switch Card',
  description:      'Card universale per switch di rete gestiti in Home Assistant. Supporta qualsiasi brand, 8/24 porte e oltre, SFP, tooltip, etichette porta, temi colore.',
  preview:          true,
  documentationURL: 'https://github.com/YOUR_USERNAME/managed-switch-card',
});
