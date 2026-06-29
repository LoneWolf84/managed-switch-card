/**
 * managed-switch-card  v2.0.0
 * Universal Lovelace card for managed network switches in Home Assistant.
 * Works with any brand/model that exposes the right sensor entities.
 *
 * License: MIT
 */

// ─────────────────────────────────────────────────────────────────────────────
//  DEFAULTS
//  All values here are neutral starting points.
//  Entity suffixes, labels and options are configured per-user in the card
//  editor or via YAML — nothing here is specific to any brand or installation.
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULTS = {
  // Header
  title:  'SWITCH',
  model:  '',           // shown as "Modello: X" — leave empty to hide
  ports:  4,            // start small; user sets their actual port count

  // Entity bases — always empty; user fills via editor
  sensor_base: '',      // optional — set via editor or per-entity pickers
  binary_base: '',      // optional — set via editor or per-entity pickers

  // Entity suffixes — generic defaults that match common integrations.
  // Override any of these in YAML if your integration uses different names.
  suffix_ip:       '_ip_address',
  suffix_sn:       '_switch_serial_number',
  suffix_fw:       '_switch_firmware',
  suffix_boot:     '_switch_bootlader',
  suffix_io:       '_switch_io',
  suffix_rx:       '_switch_traffic_received',
  suffix_tx:       '_switch_traffic_sent',
  suffix_status:   '_port_{N}_status',
  suffix_speed:    '_port_{N}_link_speed',
  suffix_port_rx:  '_port_{N}_traffic_received',
  suffix_port_tx:  '_port_{N}_traffic_sent',

  // Override full entity ids for traffic stats (optional)
  io_entity: '',
  rx_entity: '',
  tx_entity: '',

  // input_select for port selection automations (optional)
  input_select:               '',
  input_select_option_prefix: 'Port ',    // e.g. "Port 1" — change to match your options
  input_select_none:          'None',     // the "no selection" option value

  // Reboot button (optional)
  reboot_button: '',

  // Layout
  layout: 'auto',    // 'auto' | 'single' | 'double'

  // Special ports — empty by default, user configures in editor
  sfp_ports:    [],
  uplink_ports: [],
  port_labels:  {},

  // LED speed tiers — covers most common speeds; extend in YAML for 2.5G / 5G
  speed_tiers: [
    { match: ['10000', '10g'],  color: '#00cfff', shadow: '0 0 6px #00cfff', label: '10G'  },
    { match: ['1000',  '1g'],   color: '#00ff41', shadow: '0 0 5px #00ff41', label: '1G'   },
    { match: ['100'],            color: '#ff9900', shadow: '0 0 5px #ff9900', label: '100'  },
    { match: ['10'],             color: '#ff4444', shadow: '0 0 5px #ff4444', label: '10'   },
  ],

  // Colors
  color_bg:           '#1a1a1a',
  color_port_bg:      '#111',
  color_port_border:  '#333',
  color_text:         '#ffffff',
  color_accent:       '#4a90e2',
  color_sep:          '#444',
  color_led_off:      '#222',
  color_footer_border:'#333',
  color_port_num:     '#888',

  // Feature flags
  show_reboot:  true,
  show_stats:   true,
  show_tooltip: true,
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
    // Minimal blank canvas — user fills in sensor_base, binary_base and ports
    // via the card editor. Nothing specific to any installation.
    return {
      title:       'SWITCH',
      model:       '',
      ports:       4,
      sensor_base: '',
      binary_base: '',
    };
  }

  // ── Config ────────────────────────────────────────────────────────────────
  setConfig(config) {
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

  // Returns override entity if set, else builds from base+suffix.
  // overrideKey: e.g. 'override_status_3' for port 3 status
  _portEntity(suffix_key, portNum) {
    const cfg = this._config;
    // Check per-port entity (set via editor pickers, keys: speed_N, rx_N, tx_N)
    const keyMap = {
      suffix_speed:   `speed_${portNum}`,
      suffix_port_rx: `rx_${portNum}`,
      suffix_port_tx: `tx_${portNum}`,
    };
    const perPortKey = keyMap[suffix_key];
    if (perPortKey && cfg[perPortKey]) return cfg[perPortKey];
    // Fall back to sensor_base + suffix
    if (!cfg.sensor_base) return null;
    const suffix = cfg[suffix_key].replace('{N}', portNum);
    return cfg.sensor_base + suffix;
  }

  _binaryPortEntity(suffix_key, portNum) {
    const cfg = this._config;
    // Check per-port entity (key: status_N)
    const perPortKey = `status_${portNum}`;
    if (suffix_key === 'suffix_status' && cfg[perPortKey]) return cfg[perPortKey];
    if (!cfg.binary_base) return null;
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
    const status = statusEntity ? s[statusEntity]?.state : undefined;
    const speed  = (speedEntity ? s[speedEntity]?.state : null) || '';

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
    const portRx = portRxEnt ? (s[portRxEnt]?.state ?? null) : null;
    const portTx = portTxEnt ? (s[portTxEnt]?.state ?? null) : null;

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
      // gap:8px for single-row layout
      return `<div class="port-row" style="grid-template-columns:repeat(${n},1fr);gap:8px;margin-bottom:20px">${html}</div>`;
    }

    // double: odd ports top row, even ports bottom row
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

    // Traffic stats — override entity wins; else base+suffix; else N/A
    const ioEnt = cfg.io_entity || (cfg.sensor_base ? cfg.sensor_base + cfg.suffix_io : null);
    const rxEnt = cfg.rx_entity || (cfg.sensor_base ? cfg.sensor_base + cfg.suffix_rx : null);
    const txEnt = cfg.tx_entity || (cfg.sensor_base ? cfg.sensor_base + cfg.suffix_tx : null);
    const io = (ioEnt ? s[ioEnt]?.state : null) || 'N/A';
    const rx = (rxEnt ? s[rxEnt]?.state : null) || 'N/A';
    const tx = (txEnt ? s[txEnt]?.state : null) || 'N/A';

    // Header info — per-entity picker wins, then sensor_base+suffix, then N/A
    const ipEnt   = cfg.ip_entity || (cfg.sensor_base ? cfg.sensor_base + cfg.suffix_ip   : null);
    const snEnt   = cfg.sn_entity || (cfg.sensor_base ? cfg.sensor_base + cfg.suffix_sn   : null);
    const fwEnt   = cfg.fw_entity || (cfg.sensor_base ? cfg.sensor_base + cfg.suffix_fw   : null);
    const blEnt   = cfg.bl_entity || (cfg.suffix_boot && cfg.sensor_base ? cfg.sensor_base + cfg.suffix_boot : null);
    const ip   = (ipEnt ? s[ipEnt]?.state  : null) || 'N/A';
    const sn   = (snEnt ? s[snEnt]?.state  : null) || 'N/A';
    const fw   = (fwEnt ? s[fwEnt]?.state  : null) || 'N/A';
    const boot = blEnt ? (s[blEnt]?.state || 'N/A') : null;

    // Count active ports — per-port entity (status_N) or base+suffix
    let activeCount = 0;
    for (let i = 1; i <= cfg.ports; i++) {
      const ent = cfg[`status_${i}`]
        || (cfg.binary_base ? cfg.binary_base + cfg.suffix_status.replace('{N}', i) : null);
      if (ent && s[ent]?.state === 'on') activeCount++;
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
    const cfg = this._config;
    const [i, speed, portRx, portTx, status, customLabel] = raw.split('|');

    const existing = this.shadowRoot.querySelector('.sw-tip');
    if (existing) existing.remove();

    const statusHtml = status === 'on'
      ? `<span style="color:#00ff41">● Attiva</span>`
      : `<span style="color:#555">○ Inattiva</span>`;

    const nameRow = customLabel
      ? `<div class="t-title">${cfg.input_select_option_prefix}${i} — ${customLabel}</div>`
      : `<div class="t-title">${cfg.input_select_option_prefix}${i}</div>`;

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

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._step = 1;  // 1=struttura, 2=sensori porta, 3=sensori globali+opzioni
  }

  setConfig(config) {
    this._config = { ...DEFAULTS, ...config };
    // If already configured jump to step 2
    if ((this._config.ports > 1 || Object.keys(config).length > 2) && this._step === 1) this._step = 2;
    this._render();
  }

  set hass(h) {
    this._hass = h;
    // Update hass on any already-attached pickers
    if (this.shadowRoot) {
      this.shadowRoot.querySelectorAll('ha-entity-picker').forEach(p => p.hass = h);
    }
  }

  // ── Event firing ──────────────────────────────────────────────────────────
  _fire(cfg) {
    this.dispatchEvent(new CustomEvent('config-changed', {
      detail: { config: cfg }, bubbles: true, composed: true,
    }));
  }

  _set(key, val) {
    const cfg = { ...this._config, [key]: val };
    this._config = cfg;
    this._fire(cfg);
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  _goStep(n) { this._step = n; this._render(); }

  // ── Shared CSS ────────────────────────────────────────────────────────────
  _css() {
    return `
      <style>
        :host { display:block; font-family:Arial,sans-serif; font-size:13px; color:#eee; }
        /* Steps bar */
        .steps { display:flex; gap:0; margin-bottom:18px; border-radius:8px; overflow:hidden; }
        .step-btn {
          flex:1; padding:8px 4px; text-align:center; font-size:11px; font-weight:bold;
          text-transform:uppercase; letter-spacing:.5px; cursor:pointer; border:none;
          background:#1e1e1e; color:#555; transition:.2s; border-right:1px solid #333;
        }
        .step-btn:last-child { border-right:none; }
        .step-btn.active { background:#4a90e2; color:#fff; }
        .step-btn.done   { background:#1a3a1a; color:#00ff41; }
        /* Sections */
        .section { margin-bottom:4px; }
        h4 { margin:16px 0 8px; font-size:11px; text-transform:uppercase; letter-spacing:.6px;
              color:#4a90e2; border-top:1px solid #2a2a2a; padding-top:12px; }
        h4:first-child, h4.first { border-top:none; margin-top:0; }
        /* Fields */
        .row { margin-bottom:10px; }
        label { display:block; font-size:11px; color:#888; margin-bottom:3px; }
        input, select {
          width:100%; padding:6px 8px; border-radius:6px; border:1px solid #444;
          background:#1a1a1a; color:#fff; font-size:13px; box-sizing:border-box;
        }
        small { display:block; font-size:10px; color:#555; margin-top:3px; }
        /* Entity picker rows */
        .picker-row { margin-bottom:12px; }
        .picker-row label { margin-bottom:4px; }
        ha-entity-picker { display:block; }
        /* Port grid preview inside editor */
        .port-grid { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0; }
        .port-pill {
          padding:3px 10px; border-radius:12px; font-size:11px; font-weight:bold;
          background:#222; border:1px solid #444; color:#888; cursor:default;
        }
        .port-pill.sfp  { border-color:#4a90e2; color:#4a90e2; }
        .port-pill.upl  { border-color:#ff9900; color:#ff9900; }
        /* Nav buttons */
        .nav { display:flex; gap:8px; margin-top:16px; }
        .nav-btn {
          flex:1; padding:8px; border-radius:6px; border:none; cursor:pointer;
          font-size:13px; font-weight:bold;
        }
        .nav-btn.prev { background:#2a2a2a; color:#aaa; }
        .nav-btn.next { background:#4a90e2; color:#fff; }
        /* Collapsible advanced */
        details { margin-top:8px; }
        summary { font-size:11px; color:#4a90e2; cursor:pointer; user-select:none; margin-bottom:8px; }
        /* Color grid */
        .color-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
        .color-row { display:flex; align-items:center; gap:8px; }
        .color-row label { flex:1; margin:0; }
        .color-row input[type=color] { width:36px; height:28px; padding:2px; border-radius:4px; flex-shrink:0; }
        /* Toggle */
        .toggle-row { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
        .toggle-row label { margin:0; }
        .toggle-row select { width:auto; }
      </style>
    `;
  }

  // ── Step bar ──────────────────────────────────────────────────────────────
  _stepBar() {
    const c = this._config;
    const done1 = !!(c.ports > 0);
    const done2 = done1;
    const labels = ['1 · Struttura', '2 · Sensori porta', '3 · Globali & Opzioni'];
    return `<div class="steps">` + labels.map((l, i) => {
      const n = i + 1;
      const cls = this._step === n ? 'active' : (n < this._step || (n===1 && done1) ? 'done' : '');
      return `<button class="step-btn ${cls}" onclick="this.getRootNode().host._goStep(${n})">${l}</button>`;
    }).join('') + `</div>`;
  }

  // ── Entity picker helper ──────────────────────────────────────────────────
  // ha-entity-picker CANNOT be used via innerHTML — it must be created as a
  // real DOM element and have .hass / .value set as JS properties.
  // We store pending pickers and attach them in _attachPickers() after render.
  _picker(label, key, domain, hint) {
    // Render a placeholder div; _attachPickers() replaces it with a real picker.
    return `<div class="picker-row" data-picker-key="${key}" data-picker-domain="${domain||''}" data-picker-hint="${hint||''}">
      <label>${label}</label>
      <div class="picker-slot" id="picker-${key}"></div>
      ${hint ? `<small>${hint}</small>` : ''}
    </div>`;
  }

  _attachPickers() {
    if (!this.shadowRoot) return;
    this.shadowRoot.querySelectorAll('[data-picker-key]').forEach(row => {
      const key    = row.dataset.pickerKey;
      const domain = row.dataset.pickerDomain;
      const slot   = row.querySelector('.picker-slot');
      if (!slot || slot.querySelector('ha-entity-picker')) return; // already attached

      const picker = document.createElement('ha-entity-picker');
      picker.setAttribute('allow-custom-entity', '');
      if (domain) picker.includeDomains = [domain];
      if (this._hass) picker.hass = this._hass;
      // Set current value as JS property (not attribute)
      const current = this._config?.[key] || '';
      if (current) picker.value = current;

      picker.addEventListener('value-changed', (e) => {
        const val = e.detail?.value ?? '';
        if (val === (this._config?.[key] || '')) return; // no change
        this._config = { ...this._config, [key]: val };
        this._fire(this._config);
        // Update picker value without full re-render
        picker.value = val;
      });

      slot.appendChild(picker);
    });
  }

  // ── Simple input / select ─────────────────────────────────────────────────
  _input(label, key, type = 'text', hint = '') {
    const v = String(this._config?.[key] ?? '');
    return `<div class="row"><label>${label}</label>
      <input type="${type}" value="${v.replace(/"/g,'&quot;')}" data-key="${key}"
             onchange="this.getRootNode().host._inputChange(event)"/>
      ${hint ? `<small>${hint}</small>` : ''}</div>`;
  }

  _sel(label, key, opts) {
    const cur = String(this._config?.[key] ?? opts[0].v);
    const os = opts.map(o=>`<option value="${o.v}"${cur===String(o.v)?' selected':''}>${o.l}</option>`).join('');
    return `<div class="row"><label>${label}</label>
      <select data-key="${key}" onchange="this.getRootNode().host._inputChange(event)">${os}</select></div>`;
  }

  _color(label, key) {
    const v = this._config?.[key] || '#000000';
    return `<div class="color-row">
      <label>${label}</label>
      <input type="color" value="${v}" data-key="${key}" onchange="this.getRootNode().host._inputChange(event)"/>
    </div>`;
  }

  // ── STEP 1: Struttura ─────────────────────────────────────────────────────
  _renderStep1() {
    return `
      ${this._css()}
      <div style="padding:16px">
        ${this._stepBar()}

        <h4 class="first">Identità</h4>
        ${this._input('Titolo (logo)', 'title')}
        ${this._input('Modello', 'model', 'text', 'es. GS108Ev3 — lascia vuoto per nascondere')}

        <h4>Struttura porte</h4>
        ${this._input('Numero porte', 'ports', 'number')}
        ${this._sel('Layout', 'layout', [
          {v:'auto',   l:'Auto — singola ≤12, doppia >12'},
          {v:'single', l:'Riga singola'},
          {v:'double', l:'Doppia riga (dispari sopra / pari sotto)'},
        ])}

        <h4>Input select</h4>
        <p style="font-size:11px;color:#888;margin:0 0 10px">
          Deve corrispondere esattamente alle opzioni del tuo input_select in HA.<br>
          Prefisso opzione: es. <b>Porta </b> → genera "Porta 1", "Porta 2".<br>
          Valore nessuna: es. <b>Nessuna</b> → valore quando nessuna porta è selezionata.
        </p>
        ${this._input('Prefisso opzione porta', 'input_select_option_prefix', 'text', 'es. Porta  (con spazio finale)')}
        ${this._input('Valore nessuna selezione', 'input_select_none', 'text', 'es. Nessuna')}

        <h4>Porte speciali</h4>
        ${this._input('Porte SFP (es. 25,26)', 'sfp_ports_raw', 'text')}
        ${this._input('Porte Uplink (es. 8)', 'uplink_ports_raw', 'text')}
        ${this._input('Etichette porta (JSON)', 'port_labels_raw', 'text', 'es. {"1":"NAS","5":"AP"}')}

        <div class="nav">
          <button class="nav-btn next" onclick="this.getRootNode().host._goStep(2)">Avanti → Sensori →</button>
        </div>
      </div>`;
  }

  // ── STEP 2: Sensori ───────────────────────────────────────────────────────
  _renderStep2() {
    const c     = this._config;
    const ports = parseInt(c.ports, 10) || 4;

    const portPickersHtml = Array.from({length: ports}, (_, i) => i + 1).map(n => `
      <details>
        <summary>Porta ${n}${c.port_labels?.[String(n)] ? ' — ' + c.port_labels[String(n)] : ''}</summary>
        ${this._picker('Stato (link attivo)', `status_${n}`, 'binary_sensor',
            'Binary: on = porta attiva')}
        ${this._picker('Velocità link', `speed_${n}`, 'sensor',
            'es. 100, 1000, 1G — usato per il colore del LED')}
        ${this._picker('Traffico ricevuto', `rx_${n}`, 'sensor',
            'MB ricevuti su questa porta')}
        ${this._picker('Traffico inviato', `tx_${n}`, 'sensor',
            'MB inviati su questa porta')}
      </details>`).join('');

    return `
      ${this._css()}
      <div style="padding:16px">
        ${this._stepBar()}

        <h4 class="first">Sensori per ogni porta</h4>
        <p style="font-size:11px;color:#888;margin:0 0 12px">
          Seleziona i sensori di ogni porta. Se usi i <b>sensori base</b> in fondo a questa pagina
          puoi lasciare vuoto ciò che segue il pattern automatico.
        </p>
        ${portPickersHtml}

        <h4>Informazioni switch</h4>
        <p style="font-size:11px;color:#888;margin:0 0 10px">
          Dati mostrati nell'header della card (IP, numero seriale, firmware, bootloader).
        </p>
        ${this._picker('Indirizzo IP', 'ip_entity', 'sensor')}
        ${this._picker('Numero seriale', 'sn_entity', 'sensor')}
        ${this._picker('Firmware', 'fw_entity', 'sensor')}
        ${this._picker('Bootloader', 'bl_entity', 'sensor', 'opzionale — lascia vuoto per nascondere')}

        <h4>Traffico globale switch</h4>
        ${this._picker('I/O switch (MB/s)', 'io_entity', 'sensor')}
        ${this._picker('Ricevuti totali (MB)', 'rx_entity', 'sensor')}
        ${this._picker('Inviati totali (MB)', 'tx_entity', 'sensor')}

        <h4>Azioni</h4>
        ${this._picker('Input select selezione porta', 'input_select', 'input_select')}
        ${this._picker('Pulsante reboot', 'reboot_button', 'button')}

        <h4>Sensori base (opzionale)</h4>
        <p style="font-size:11px;color:#888;margin:0 0 10px">
          Se tutti i tuoi sensori seguono un pattern comune, inserisci il prefisso
          e la card li configurerà in automatico. Lascia vuoto se hai già selezionato
          tutto manualmente sopra.
        </p>
        ${this._input('Prefisso sensori (sensor base)', 'sensor_base', 'text',
            'es. sensor.myswitch_192_168_1_1')}
        ${this._input('Prefisso binary sensori (binary base)', 'binary_base', 'text',
            'es. binary_sensor.myswitch_192_168_1_1')}

        <div class="nav">
          <button class="nav-btn prev" onclick="this.getRootNode().host._goStep(1)">← Struttura</button>
          <button class="nav-btn next" onclick="this.getRootNode().host._goStep(3)">→ Suffissi & Opzioni</button>
        </div>
      </div>`;
  }

  // ── STEP 3: Suffissi & Opzioni ────────────────────────────────────────────
  _renderStep3() {
    return `
      ${this._css()}
      <div style="padding:16px">
        ${this._stepBar()}

        <details open>
          <summary style="font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#4a90e2;cursor:pointer;font-weight:bold">⚙ Suffissi entità</summary>
          <p style="font-size:11px;color:#888;margin:8px 0">
            Modificare solo se la tua integrazione usa nomi diversi da quelli standard.
            <code style="background:#222;padding:1px 4px;border-radius:3px">{N}</code> = numero porta.
          </p>
          ${this._input('Suffisso IP',               'suffix_ip',     'text')}
          ${this._input('Suffisso SN',               'suffix_sn',     'text')}
          ${this._input('Suffisso FW',               'suffix_fw',     'text')}
          ${this._input('Suffisso Bootloader',       'suffix_boot',   'text', 'vuoto = nasconde BL')}
          ${this._input('Suffisso I/O globale',      'suffix_io',     'text')}
          ${this._input('Suffisso RX globale',       'suffix_rx',     'text')}
          ${this._input('Suffisso TX globale',       'suffix_tx',     'text')}
          ${this._input('Suffisso stato porta {N}',  'suffix_status', 'text')}
          ${this._input('Suffisso velocità porta {N}','suffix_speed', 'text')}
          ${this._input('Suffisso RX porta {N}',     'suffix_port_rx','text')}
          ${this._input('Suffisso TX porta {N}',     'suffix_port_tx','text')}
        </details>

        <h4>Funzionalità</h4>
        ${this._sel('Pulsante reboot',     'show_reboot',  [{v:'true',l:'Sì'},{v:'false',l:'No'}])}
        ${this._sel('Statistiche traffico','show_stats',   [{v:'true',l:'Sì'},{v:'false',l:'No'}])}
        ${this._sel('Tooltip hover porte', 'show_tooltip', [{v:'true',l:'Sì'},{v:'false',l:'No'}])}

        <h4>Colori</h4>
        <div class="color-grid">
          ${this._color('Sfondo card',   'color_bg')}
          ${this._color('Sfondo porta',  'color_port_bg')}
          ${this._color('Bordo porta',   'color_port_border')}
          ${this._color('Testo',         'color_text')}
          ${this._color('Accento',       'color_accent')}
          ${this._color('Separatore',    'color_sep')}
          ${this._color('LED spento',    'color_led_off')}
        </div>

        <div class="nav">
          <button class="nav-btn prev" onclick="this.getRootNode().host._goStep(2)">← Sensori porta</button>
        </div>
      </div>`;
  }

  // ── Main render ───────────────────────────────────────────────────────────
  _render() {
    if (!this.shadowRoot) return;
    // Save which <details> are currently open (by their summary text)
    const openSummaries = new Set();
    this.shadowRoot.querySelectorAll('details[open] > summary').forEach(s => {
      openSummaries.add(s.textContent.trim());
    });

    this.shadowRoot.innerHTML =
      this._step === 1 ? this._renderStep1()
    : this._step === 2 ? this._renderStep2()
    : this._renderStep3();

    // Restore open state — re-open any <details> whose summary matches
    if (openSummaries.size > 0) {
      this.shadowRoot.querySelectorAll('details > summary').forEach(s => {
        if (openSummaries.has(s.textContent.trim())) {
          s.parentElement.setAttribute('open', '');
        }
      });
    }

    requestAnimationFrame(() => this._attachPickers());
  }

  // Picker changes are handled inline in _attachPickers() per picker.


  _inputChange(e) {
    const key = e.target.dataset.key;
    let val = e.target.value;
    let cfg = { ...this._config };

    if (key === 'ports')            { cfg.ports = parseInt(val,10)||8; this._config=cfg; this._fire(cfg); return; }
    if (key === 'sfp_ports_raw')    { cfg.sfp_ports = val.split(',').map(v=>parseInt(v.trim(),10)).filter(Boolean); this._config=cfg; this._fire(cfg); return; }
    if (key === 'uplink_ports_raw') { cfg.uplink_ports = val.split(',').map(v=>parseInt(v.trim(),10)).filter(Boolean); this._config=cfg; this._fire(cfg); return; }
    if (key === 'port_labels_raw')  { try{cfg.port_labels=JSON.parse(val);}catch{} this._config=cfg; this._fire(cfg); return; }
    if (['show_reboot','show_stats','show_tooltip'].includes(key)) { cfg[key]=val==='true'; this._config=cfg; this._fire(cfg); return; }
    cfg[key] = val;
    this._config = cfg;
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
