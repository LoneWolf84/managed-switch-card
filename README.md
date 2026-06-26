# 🖧 Managed Switch Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)
[![GitHub release](https://img.shields.io/github/v/release/YOUR_USERNAME/managed-switch-card)](https://github.com/YOUR_USERNAME/managed-switch-card/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Universal Lovelace card for managed network switches in Home Assistant.
Works with any brand and model — all entity names configured privately via the card editor.

---

## ✨ Features

| | |
|---|---|
| **Any brand / model** | Fully configurable entity prefixes and suffixes |
| **Any port count** | 4 to 48+, automatic or forced layout |
| **LED status** | 🟢 1G · 🟠 100M · 🔵 10G · off = no link |
| **Custom speed tiers** | Add 2.5G, 5G or any speed |
| **SFP / Uplink ports** | Distinct visual badge |
| **Port labels** | Custom text per port |
| **Hover tooltip** | Per-port status, speed, RX/TX |
| **Port selection** | Click updates `input_select` for automations |
| **Reboot button** | With confirm dialog |
| **Traffic stats** | I/O, RX, TX — override entity supported |
| **Full color customization** | Background, ports, accent, LED off |
| **3-step visual editor** | No YAML required |

---

## 📦 Installation

### Via HACS (recommended)

1. HACS → **Frontend** → `⋮` → **Custom repositories**
2. URL: `https://github.com/YOUR_USERNAME/managed-switch-card` — Category: **Lovelace**
3. Install and reload browser

### Manual

1. Download `managed-switch-card.js` and `managed-switch-port-card.js` from the [latest release](https://github.com/YOUR_USERNAME/managed-switch-card/releases/latest)
2. Copy to `config/www/`
3. HA → **Settings → Dashboard → Resources**:
   ```
   /local/managed-switch-card.js       → JavaScript Module
   /local/managed-switch-port-card.js  → JavaScript Module
   ```

---

## ⚙️ Configuration

All configuration is done **privately inside Home Assistant** through the card's visual editor.
No sensitive data (entity names, IP addresses, device names) is stored in any public file.

### Adding the card

1. Edit your dashboard → **Add card** → search **Managed Switch Card**
2. The editor opens with 3 steps:
   - **Step 1 · Structure** — port count, layout, labels
   - **Step 2 · Port sensors** — select entity base (prefix extracted automatically), input select, reboot button, per-port overrides
   - **Step 3 · Global & Options** — feature toggles, colors, advanced suffixes

### Entity patterns expected

The card builds entity names as `{sensor_base}{suffix}` and `{binary_base}{suffix}`.
Suffixes are fully configurable in Step 3 → Advanced.

Default suffix patterns:
```
binary_sensor.{binary_base}_port_N_status
sensor.{sensor_base}_port_N_link_speed
sensor.{sensor_base}_port_N_traffic_received
sensor.{sensor_base}_port_N_traffic_sent
sensor.{sensor_base}_ip_address
sensor.{sensor_base}_switch_serial_number
sensor.{sensor_base}_switch_firmware
sensor.{sensor_base}_switch_bootlader
sensor.{sensor_base}_switch_io
sensor.{sensor_base}_switch_traffic_received
sensor.{sensor_base}_switch_traffic_sent
```

---

## 🗺️ managed-switch-port-card

Companion detail card — shows live port stats when a port is selected.
Disappears automatically when no port is selected.

| Selection | Content |
|---|---|
| Port N | I/O speed + historical graph · RX/TX totals |
| (none) | Hidden — no space taken |

Configure via its own visual editor: select which `input_select` entities to watch, then configure sensor bases per switch.

---

## 🗂️ Repository structure

```
managed-switch-card/
├── managed-switch-card.js         ← main card
├── managed-switch-port-card.js    ← companion port detail card
├── hacs.json
├── info.md
├── README.md
├── LICENSE
├── .gitignore
└── .github/
    ├── workflows/release.yml
    └── ISSUE_TEMPLATE/
```

---

## 📋 Changelog

### v1.0.0
- Universal card — any brand, any port count
- 3-step visual editor with `ha-entity-picker`
- Auto-extraction of entity base prefix from selected entity
- SFP, uplink, port labels, tooltip, colors all configurable
- Companion port detail card with historical graph
- No personal data in public files

---

## 📄 License

MIT — see [LICENSE](LICENSE)
