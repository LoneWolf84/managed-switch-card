# 🖧 Managed Switch Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)
[![GitHub release](https://img.shields.io/github/v/release/YOUR_USERNAME/managed-switch-card)](https://github.com/YOUR_USERNAME/managed-switch-card/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Card Lovelace universale per switch di rete gestiti in **Home Assistant**.  
Nata dalla fusione delle card originali per Managed Switch MySwitch-8 (8 porte) e MySwitch-24 (24 porte), ora funziona con **qualsiasi brand e qualsiasi numero di porte** — basta avere le entità giuste in HA.

---

## ✨ Funzionalità

| | |
|---|---|
| **Qualsiasi brand e modello** | Tutto configurabile: prefissi entità, suffissi, etichette, colori |
| **Qualsiasi numero di porte** | Da 4 a 48+, con layout automatico o forzato |
| **Logica LED fedele agli originali** | 🟢 1G · 🟠 100M · 🔵 10G · spento = no link |
| **Tiers di velocità personalizzabili** | Aggiungi o sostituisci le soglie (es. 2.5G, 5G) |
| **Layout singolo / doppio** | Auto: riga singola ≤12 porte, doppia riga >12 |
| **Porte SFP** | Badge blu + stile bay diverso |
| **Porte Uplink** | Badge arancio `UPL` |
| **Etichette porta** | Testo fisso al posto della velocità (es. `"NAS"`) |
| **Tooltip hover** | Stato, velocità, RX/TX per porta |
| **Selezione porta** | Click aggiorna `input_select` per automazioni |
| **Pulsante reboot** | Con conferma, via entità `button` |
| **Statistiche traffico** | I/O, RX, TX globali — override entità supportato |
| **Colori completamente configurabili** | Sfondo, porte, accento, LED spento, separatori |
| **Editor visivo Lovelace** | Zero YAML necessario |

---

## 📦 Installazione

### Via HACS (consigliato)

1. HACS → **Frontend** → `⋮` → **Repository personalizzati**
2. URL: `https://github.com/YOUR_USERNAME/managed-switch-card` — Categoria: **Lovelace**
3. Installa e ricarica la cache del browser

### Manuale

1. Scarica `managed-switch-card.js` e `managed-switch-port-card.js` dall'[ultima release](https://github.com/YOUR_USERNAME/managed-switch-card/releases/latest)
2. Copiali entrambi in `config/www/`
3. HA → **Impostazioni → Dashboard → Risorse** — aggiungi entrambi:

   | URL | Tipo |
   |-----|------|
   | `/local/managed-switch-card.js` | JavaScript Module |
   | `/local/managed-switch-port-card.js` | JavaScript Module |

4. Ricarica la pagina

> **Via HACS** i file vengono copiati in `www/community/managed-switch-card/` e i percorsi diventano `/hacsfiles/managed-switch-card/managed-switch-card.js` — gestiti in automatico.

---

## ⚙️ Configurazione

### Minima (obbligatoria)

```yaml
type: custom:managed-switch-card
sensor_base: sensor.myswitch1_192_168_1_1
binary_base: binary_sensor.myswitch1_192_168_1_1
```

---

### Esempio: Managed Switch MySwitch-8 — 8 porte (equivalente all'originale)

```yaml
type: custom:managed-switch-card
title: SWITCH
model: MySwitch-8
ports: 8
sensor_base: sensor.myswitch1_192_168_1_1
binary_base: binary_sensor.myswitch1_192_168_1_1
input_select: input_select.port_selector_sw1
reboot_button: button.myswitch1_192_168_1_1_reboot_switch
# Lo switch-8 originale leggeva le statistiche traffico da un sensore
# appartenente al 24 — usa gli override per replicare questo comportamento:
io_entity: sensor.myswitch2_192_168_1_2_switch_io
rx_entity: sensor.myswitch2_192_168_1_2_switch_traffic_received
tx_entity: sensor.myswitch2_192_168_1_2_switch_traffic_sent
uplink_ports:
  - 8
port_labels:
  "1": "NAS"
  "2": "PC"
```

---

### Esempio: Managed Switch MySwitch-24 — 24 porte (equivalente all'originale)

```yaml
type: custom:managed-switch-card
title: SWITCH
model: MySwitch-24
ports: 24
sensor_base: sensor.myswitch2_192_168_1_2
binary_base: binary_sensor.myswitch2_192_168_1_2
input_select: input_select.port_selector_sw2
suffix_boot: ""        # il 24 originale non mostra il bootloader
layout: double
```

---

### Esempio: switch generico 48 porte con SFP

```yaml
type: custom:managed-switch-card
title: CISCO
model: SG350-52
ports: 48
sensor_base: sensor.sg350_192_168_1_5
binary_base: binary_sensor.sg350_192_168_1_5
layout: double
sfp_ports: [49, 50, 51, 52]
uplink_ports: [49, 50]
port_labels:
  "1": "Server"
  "2": "NAS"
  "49": "UPLINK"
show_tooltip: true
```

---

### Esempio: tema chiaro con colori personalizzati

```yaml
type: custom:managed-switch-card
title: TP-LINK
model: TL-SG3210
ports: 10
sensor_base: sensor.tplink_sg3210
binary_base: binary_sensor.tplink_sg3210
color_bg: "#f0f2f5"
color_port_bg: "#dde1e8"
color_port_border: "#b0b8c5"
color_text: "#1a1a1a"
color_accent: "#1a5bbf"
color_sep: "#bbb"
color_led_off: "#c0c5ce"
color_footer_border: "#ccc"
color_port_num: "#666"
```

---

### Esempio: velocità personalizzate (es. switch 2.5G/10G)

```yaml
type: custom:managed-switch-card
title: QNAP
model: QSW-M408-4C
ports: 12
sensor_base: sensor.qnap_switch
binary_base: binary_sensor.qnap_switch
sfp_ports: [9, 10, 11, 12]
speed_tiers:
  - match: ["10000", "10g"]
    color: "#00cfff"
    shadow: "0 0 6px #00cfff"
    label: "10G"
  - match: ["2500", "2.5g"]
    color: "#cc44ff"
    shadow: "0 0 5px #cc44ff"
    label: "2.5G"
  - match: ["1000", "1g"]
    color: "#00ff41"
    shadow: "0 0 5px #00ff41"
    label: "1G"
  - match: ["100"]
    color: "#ff9900"
    shadow: "0 0 5px #ff9900"
    label: "100"
```

---

## 🔧 Tutte le opzioni

### Generali

| Opzione | Default | Descrizione |
|---|---|---|
| `title` | `SWITCH` | Titolo mostrato in alto a sinistra |
| `model` | `""` | Modello switch (se vuoto, la riga "Modello:" è omessa) |
| `ports` | `8` | Numero totale di porte |
| `layout` | `auto` | `auto` / `single` / `double` |

### Entità

| Opzione | Default | Descrizione |
|---|---|---|
| `sensor_base` | **obbligatorio** | Prefisso delle entità `sensor.*` |
| `binary_base` | **obbligatorio** | Prefisso delle entità `binary_sensor.*` |
| `input_select` | `""` | Entità `input_select` per selezione porta |
| `reboot_button` | `""` | Entità `button` per riavvio switch |
| `io_entity` | `""` | Override completo per il sensore I/O |
| `rx_entity` | `""` | Override completo per il sensore RX globale |
| `tx_entity` | `""` | Override completo per il sensore TX globale |

### Suffissi entità (avanzato)

Questi valori vengono **concatenati a `sensor_base` o `binary_base`** per formare il nome entità completo.  
Nei suffissi delle porte, `{N}` viene sostituito con il numero porta.

| Opzione | Default |
|---|---|
| `suffix_ip` | `_ip_address` |
| `suffix_sn` | `_switch_serial_number` |
| `suffix_fw` | `_switch_firmware` |
| `suffix_boot` | `_switch_bootlader` (vuoto = nascosto) |
| `suffix_io` | `_switch_io` |
| `suffix_rx` | `_switch_traffic_received` |
| `suffix_tx` | `_switch_traffic_sent` |
| `suffix_status` | `_port_{N}_status` |
| `suffix_speed` | `_port_{N}_link_speed` |
| `suffix_port_rx` | `_port_{N}_traffic_received` |
| `suffix_port_tx` | `_port_{N}_traffic_sent` |

### Porte speciali

| Opzione | Default | Descrizione |
|---|---|---|
| `sfp_ports` | `[]` | Lista numeri porta da visualizzare come SFP |
| `uplink_ports` | `[]` | Lista numeri porta con badge `UPL` |
| `port_labels` | `{}` | Mappa `"porta": "etichetta"` |

### Colori

| Opzione | Default |
|---|---|
| `color_bg` | `#1a1a1a` |
| `color_port_bg` | `#111` |
| `color_port_border` | `#333` |
| `color_text` | `#ffffff` |
| `color_accent` | `#4a90e2` |
| `color_sep` | `#444` |
| `color_led_off` | `#222` |
| `color_footer_border` | `#333` |
| `color_port_num` | `#888` |

### Speed tiers

Lista di oggetti, valutati in ordine. Il primo match vince.

```yaml
speed_tiers:
  - match: ["10000", "10g"]   # stringa o lista di stringhe (case-insensitive)
    color: "#00cfff"
    shadow: "0 0 6px #00cfff"
    label: "10G"
```

### Funzionalità

| Opzione | Default | Descrizione |
|---|---|---|
| `show_reboot` | `true` | Mostra pulsante reboot (richiede `reboot_button`) |
| `show_stats` | `true` | Mostra riga statistiche traffico |
| `show_tooltip` | `true` | Abilita tooltip hover sulle porte |
| `input_select_option_prefix` | `Porta ` | Prefisso opzione input_select (es. `"Porta 1"`) |
| `input_select_none` | `Nessuna` | Valore "nessuna selezione" dell'input_select |

---

## 🏠 Entità attese

Costruite automaticamente come `{base}{suffix}`:

```
binary_sensor.{binary_base}_port_N_status        → on/off
sensor.{sensor_base}_port_N_link_speed           → es. "1000", "100"
sensor.{sensor_base}_port_N_traffic_received     → MB  (tooltip)
sensor.{sensor_base}_port_N_traffic_sent         → MB  (tooltip)
sensor.{sensor_base}_ip_address
sensor.{sensor_base}_switch_serial_number
sensor.{sensor_base}_switch_firmware
sensor.{sensor_base}_switch_bootlader            → opzionale
sensor.{sensor_base}_switch_io                   → MB/s
sensor.{sensor_base}_switch_traffic_received     → MB totali
sensor.{sensor_base}_switch_traffic_sent         → MB totali
```

---

## 🤖 Automazioni con input_select

```yaml
# configuration.yaml
input_select:
  port_selector_sw1:
    name: Porta switch 8
    options:
      - Nessuna
      - Porta 1
      - Porta 2
      - Porta 3
      - Porta 4
      - Porta 5
      - Porta 6
      - Porta 7
      - Porta 8
```

---

## 📋 Changelog

### v2.0.0
- Card unificata e universale (`managed-switch-card`)
- Logica LED e comportamento click identici agli originali
- Suffissi entità tutti configurabili via YAML
- Override entità traffico (utile quando le stats vengono da un altro switch)
- Speed tiers personalizzabili (supporto 2.5G, 5G, 10G, ecc.)
- Tutti i colori esposti come opzioni YAML
- Porte SFP e Uplink con badge visivi
- Etichette porta personalizzate
- Tooltip hover per porta (stato, velocità, RX, TX)
- Editor visivo Lovelace completo
- Workflow GitHub Actions per release automatica

---

## 📄 Licenza

MIT — vedi [LICENSE](LICENSE)

---

## 🖥️ managed-switch-port-card

Card companion che mostra i dettagli della porta selezionata. Appare **solo quando una porta è selezionata** — scompare automaticamente quando si deseleziona o si cambia dashboard.

### Layout (come da screenshot)

```
┌─────────────────────┬──────────────────┬──────────────────┐
│  Velocità           │  Ultimi Dati     │  Totale Dati     │
│  Grafico I/O + val  │  I/O · RX · TX   │  RX · TX switch  │
└─────────────────────┴──────────────────┴──────────────────┘
```

### Installazione

Stesso file `managed-switch-port-card.js` da aggiungere come risorsa:
```
URL:  /hacsfiles/managed-switch-card/managed-switch-port-card.js
Tipo: JavaScript Module
```

### Configurazione

```yaml
type: custom:managed-switch-port-card

# Lista di tutti i tuoi input_select — la card usa automaticamente
# quello che non è "Nessuna" (funziona con 8 porte, 24 porte, ecc.)
input_selects:
  - input_select.port_selector_sw1
  - input_select.port_selector_sw2

# Configurazione per ogni switch, chiave = entity_id dell'input_select
switches:
  input_select.port_selector_sw1:
    sensor_base: sensor.myswitch1_192_168_1_1
    binary_base: binary_sensor.myswitch1_192_168_1_1
    ports: 8
    # Suffisso del sensore velocità per porta ({N} = numero porta)
    suffix_port_io:  _port_{N}_io
    suffix_port_rx:  _port_{N}_traffic_received
    suffix_port_tx:  _port_{N}_traffic_sent
    # Totali switch (opzionale: se le stats vengono da un altro dispositivo)
    io_entity: sensor.myswitch2_192_168_1_2_switch_io
    rx_entity: sensor.myswitch2_192_168_1_2_switch_traffic_received
    tx_entity: sensor.myswitch2_192_168_1_2_switch_traffic_sent

  input_select.port_selector_sw2:
    sensor_base: sensor.myswitch2_192_168_1_2
    binary_base: binary_sensor.myswitch2_192_168_1_2
    ports: 24
    suffix_port_io:  _port_{N}_io
    suffix_port_rx:  _port_{N}_traffic_received
    suffix_port_tx:  _port_{N}_traffic_sent

# Grafico storico
history_hours: 1         # quante ore di storico nel grafico
graph_update_ms: 5000    # ogni quanti ms aggiornare il grafico

# Colori (opzionali)
color_rx: "#ff9900"      # curva I/O (arancio originale)
color_tx: "#4a90e2"      # TX (blu)
color_accent: "#4a90e2"
color_card_bg: "#111"
```

### Opzioni managed-switch-port-card

| Opzione | Default | Descrizione |
|---|---|---|
| `input_selects` | **obbligatorio** | Lista entity_id degli input_select da monitorare |
| `switches` | **obbligatorio** | Mappa input_select → configurazione switch |
| `none_option` | `Nessuna` | Valore che significa "nessuna selezione" |
| `option_prefix` | `Porta ` | Prefisso delle opzioni (es. `"Porta 1"`) |
| `history_hours` | `1` | Ore di storico nel grafico |
| `graph_update_ms` | `5000` | Intervallo aggiornamento grafico (ms) |
| `color_rx` | `#ff9900` | Colore curva I/O/RX |
| `color_tx` | `#4a90e2` | Colore TX |
| `color_accent` | `#4a90e2` | Colore accento icone |
| `color_card_bg` | `#111` | Sfondo pannelli interni |
| `color_text` | `#ffffff` | Testo principale |
| `color_subtext` | `#888` | Testo secondario |

### Suffissi per switch (dentro `switches.<key>`)

| Opzione | Default | Descrizione |
|---|---|---|
| `sensor_base` | **obbligatorio** | Prefisso entità sensor |
| `binary_base` | **obbligatorio** | Prefisso entità binary_sensor |
| `ports` | `8` | Numero porte |
| `suffix_port_io` | `_port_{N}_io` | Velocità I/O per porta |
| `suffix_port_rx` | `_port_{N}_traffic_received` | Byte ricevuti per porta |
| `suffix_port_tx` | `_port_{N}_traffic_sent` | Byte inviati per porta |
| `suffix_rx` | `_switch_traffic_received` | Totale RX switch |
| `suffix_tx` | `_switch_traffic_sent` | Totale TX switch |
| `io_entity` | `""` | Override entità I/O totale switch |
| `rx_entity` | `""` | Override entità RX totale switch |
| `tx_entity` | `""` | Override entità TX totale switch |
| `port_labels` | `{}` | Etichette porta `{"1":"NAS"}` |
| `speed_tiers` | (standard) | Soglie velocità LED (stesso formato di managed-switch-card) |

### Esempio layout dashboard completo

```yaml
# Dashboard Lovelace
views:
  - title: Network
    cards:
      # Switch card 8 porte
      - type: custom:managed-switch-card
        title: SWITCH
        model: MySwitch-8
        ports: 8
        sensor_base: sensor.myswitch1_192_168_1_1
        binary_base: binary_sensor.myswitch1_192_168_1_1
        input_select: input_select.port_selector_sw1
        reboot_button: button.myswitch1_192_168_1_1_reboot_switch

      # Switch card 24 porte
      - type: custom:managed-switch-card
        title: SWITCH
        model: MySwitch-24
        ports: 24
        sensor_base: sensor.myswitch2_192_168_1_2
        binary_base: binary_sensor.myswitch2_192_168_1_2
        input_select: input_select.port_selector_sw2
        suffix_boot: ""

      # Detail card — appare solo quando una porta è selezionata
      - type: custom:managed-switch-port-card
        input_selects:
          - input_select.port_selector_sw1
          - input_select.port_selector_sw2
        switches:
          input_select.port_selector_sw1:
            sensor_base: sensor.myswitch1_192_168_1_1
            binary_base: binary_sensor.myswitch1_192_168_1_1
            ports: 8
            suffix_port_io: _port_{N}_io
            io_entity: sensor.myswitch2_192_168_1_2_switch_io
            rx_entity: sensor.myswitch2_192_168_1_2_switch_traffic_received
            tx_entity: sensor.myswitch2_192_168_1_2_switch_traffic_sent
          input_select.port_selector_sw2:
            sensor_base: sensor.myswitch2_192_168_1_2
            binary_base: binary_sensor.myswitch2_192_168_1_2
            ports: 24
            suffix_port_io: _port_{N}_io
```

> **Nota**: la `managed-switch-port-card` non usa `conditional` card di Lovelace — gestisce autonomamente la propria visibilità: quando nessuna porta è selezionata il componente è vuoto e non occupa spazio.
