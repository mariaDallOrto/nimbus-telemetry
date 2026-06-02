# 📡 ESP32 RC Telemetry & Data Logger

Este projeto consiste em um sistema não invasivo de telemetria para robôs de combate, focado em monitoramento de baterias LiPo (até 6S), consumo de corrente e sinais de receptor (PWM). O sistema é composto por um firmware para **ESP32** e um **Dashboard Web** para visualização em tempo real e análise de dados.

## 📋 Funcionalidades

- **Monitoramento de Bateria (6S):** Leitura individual de células de baterias LiPo (1S a 6S) utilizando dois módulos ADS1115 para alta precisão.
- **Sensor de Corrente:** Suporte ao sensor Hall HSTS016L-A (com leitura diferencial VREF/VOUT).
- **Leitura de PWM:** Monitoramento do sinal do receptor (Canal R84) para identificar a posição do stick/acelerador.
- **Data Logging (Cartão SD):** Gravação de logs em formato `.CSV` no cartão SD para análise posterior.
- **Web Dashboard (WebSocket):** Interface HTML5 moderna (sem necessidade de internet) para:
- Visualização de gráficos ao vivo (Corrente, Tensão, RPM estimado, Stick).
- Controle de gravação (Iniciar/Parar).
- Download de arquivos de log via WiFi.
- Análise de pós-voo (Upload e renderização de gráficos do CSV).

---

## 🛠️ Hardware Necessário

- **Microcontrolador:** ESP32 (Modelo DevKit V1 ou similar).
- **Sensor de Corrente:** HSTS016L-A (Alimentado com 5V).
- **ADC:** 2x Módulos ADS1115 (16-bit).
- **Armazenamento:** Módulo Leitor de Cartão SD (SPI).
- **Receptor RC:** Qualquer receptor com saída PWM (Ex: R84).
- **Componentes:** Resistores para divisores de tensão (bateria e saída do sensor de corrente).

---

## 🔌 Esquema de Ligação

### 1. Módulo Cartão SD (SPI / VSPI)

| Pino SD  | Pino ESP32 (GPIO) | Função               |
| -------- | ----------------- | -------------------- |
| **3V3**  | 3V3               | Alimentação          |
| **GND**  | GND               | Terra                |
| **CS**   | 5                 | Chip Select          |
| **MOSI** | 23                | Master Out, Slave In |
| **MISO** | 19                | Master In, Slave Out |
| **SCK**  | 18                | Clock                |

### 2. Módulos ADS1115 (I2C)

O sistema utiliza dois módulos no mesmo barramento I2C para ler as 6 células da bateria.

- **SDA (Ambos):** GPIO 21
- **SCL (Ambos):** GPIO 22
- **Alimentação:** 3.3V

**Configuração de Endereços:**

| Módulo       | Células | Ligação do Pino ADDR     | Endereço I2C |
| ------------ | ------- | ------------------------ | ------------ |
| **Módulo 1** | 1S - 4S | Ligado ao **GND**        | `0x48`       |
| **Módulo 2** | 5S - 6S | Ligado ao **VDD (3.3V)** | `0x49`       |

### 3. Sensor de Corrente (HSTS016L-A) & PWM

⚠️ **Atenção:** O sensor de corrente opera tipicamente a 5V. Como o ESP32 opera a 3.3V, é necessário utilizar um divisor de tensão nas saídas do sensor antes de conectar ao ESP32.

| Sensor / RX        | Pino ESP32 (GPIO) | Observação                              |
| ------------------ | ----------------- | --------------------------------------- |
| **VOUT Sensor**    | 35                | Saída de tensão do sensor (Via divisor) |
| **VREF Sensor**    | 34                | Tensão de referência (Via divisor)      |
| **Sinal PWM (RX)** | 32                | Sinal do Receptor (Canal R84)           |

---

## 💻 Instalação e Configuração

### Firmware (ESP32)

1. Abra o arquivo `esp-wifi.ino` na Arduino IDE.
2. Instale as bibliotecas necessárias via Gerenciador de Bibliotecas:

- `ESPAsyncWebServer`
- `AsyncTCP`
- `Adafruit ADS1X15`
- `Adafruit BusIO`

3. Configure suas credenciais WiFi no código:

```cpp
const char* ssid = "SEU_WIFI";
const char* password = "SUA_SENHA";

```

4. Verifique se os valores dos resistores divisores de tensão (bateria e sensor) correspondem ao seu hardware nas definições `#define` e na `struct divisores`.
5. Faça o upload para a ESP32.

### Dashboard (Frontend) — Nimbus Telemetry

A interface é um SPA em **React 19 + Vite + TypeScript** com a identidade visual
Nimbus (tema escuro `#141414`, accent âmbar `#FFBC00`, Geist + Geist Mono). Ela
substitui o protótipo `dash-14.html` de arquivo único, com a arquitetura de
informação repensada segundo as heurísticas de Nielsen — sem perder nenhuma
funcionalidade.

```bash
bun install
bun dev          # http://localhost:5174
bun run build    # build de produção em ./dist
bun run verify   # portão único: tsc + oxlint + knip + bun test + oxfmt
```

1. Garanta que o dispositivo (PC/celular) esteja na mesma rede WiFi da ESP32.
2. Abra o app, informe o IP exibido no Monitor Serial no campo **IP do ESP32** e
   clique em **Conectar**. O status da conexão fica sempre visível na barra
   lateral e no topo (online · conectando · reconectando · desconectado).

**Estrutura**

- `src/telemetry/` — núcleo type-safe: parser de mensagens, média móvel, eixos
  "sticky" anti-tremor, parser de CSV, estimativa de RPM e o `TelemetryContext`
  (WebSocket + reconexão, persiste ao navegar entre abas).
- `src/charts/` — gráficos `chart.js` (carregados sob demanda): combo ao vivo,
  série personalizada e mini-gráficos de visão geral.
- `src/components/` — primitivos do design system (Button, Card, Section,
  MetricTile, Field, Alert, badge de status) + shell (SideRail, MobileTopBar).
- `src/pages/` — `LivePage` (monitoramento) e `AnalysisPage` (análise de CSV).
- `tests/` — testes de comportamento das funções puras + componente (bun test).

---

## 📊 Como Usar

1. **Monitoramento:** "Monitoramento ao Vivo" mostra leituras, gráfico combinado
   (stick · corrente · RPM) com média móvel por linha e janela visível ajustável,
   além das tensões por célula.
2. **Gravação:** clique em **Iniciar** para gravar no cartão SD — um indicador
   pisca durante a gravação. Os controles ficam desabilitados enquanto offline
   (prevenção de erro).
3. **Download:** ao parar, o botão **Baixar CSV** aparece se o arquivo foi gerado.
4. **Análise:** em "Análise de CSV", arraste ou selecione o `.csv` baixado para
   montar gráficos personalizados, suavizar séries e inspecionar os dados brutos.
   Funciona de forma independente, sem precisar estar conectado à ESP32.

---

### 1,2,3... K-Torze!
