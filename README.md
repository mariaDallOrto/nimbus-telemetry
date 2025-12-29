# 📡 ESP32 RC Telemetry & Data Logger

Este projeto consiste em um sistema completo de telemetria para robôs de combate, focado em monitoramento de baterias LiPo (até 6S), consumo de corrente e sinais de receptor (PWM). O sistema é composto por um firmware para **ESP32** e um **Dashboard Web** para visualização em tempo real e análise de dados.

## 📋 Funcionalidades

* **Monitoramento de Bateria (6S):** Leitura individual de células de baterias LiPo (1S a 6S) utilizando dois módulos ADS1115 para alta precisão.
* **Sensor de Corrente:** Suporte ao sensor Hall HSTS016L-A (com leitura diferencial VREF/VOUT).
* **Leitura de PWM:** Monitoramento do sinal do receptor (Canal R84) para identificar a posição do stick/acelerador.
* **Data Logging (Cartão SD):** Gravação de logs em formato `.CSV` no cartão SD para análise posterior.
* **Web Dashboard (WebSocket):** Interface HTML5 moderna (sem necessidade de internet) para:
* Visualização de gráficos ao vivo (Corrente, Tensão, RPM estimado, Stick).
* Controle de gravação (Iniciar/Parar).
* Download de arquivos de log via WiFi.
* Análise de pós-voo (Upload e renderização de gráficos do CSV).



---

## 🛠️ Hardware Necessário

* **Microcontrolador:** ESP32 (Modelo DevKit V1 ou similar).
* **Sensor de Corrente:** HSTS016L-A (Alimentado com 5V).
* **ADC:** 2x Módulos ADS1115 (16-bit).
* **Armazenamento:** Módulo Leitor de Cartão SD (SPI).
* **Receptor RC:** Qualquer receptor com saída PWM (Ex: R84).
* **Componentes:** Resistores para divisores de tensão (bateria e saída do sensor de corrente).

---

## 🔌 Esquema de Ligação

### 1. Módulo Cartão SD (SPI / VSPI)

| Pino SD | Pino ESP32 (GPIO) | Função |
| --- | --- | --- |
| **3V3** | 3V3 | Alimentação |
| **GND** | GND | Terra |
| **CS** | 5 | Chip Select |
| **MOSI** | 23 | Master Out, Slave In |
| **MISO** | 19 | Master In, Slave Out |
| **SCK** | 18 | Clock |

### 2. Módulos ADS1115 (I2C)

O sistema utiliza dois módulos no mesmo barramento I2C para ler as 6 células da bateria.

* **SDA (Ambos):** GPIO 21
* **SCL (Ambos):** GPIO 22
* **Alimentação:** 3.3V

**Configuração de Endereços:**

| Módulo | Células | Ligação do Pino ADDR | Endereço I2C |
| --- | --- | --- | --- |
| **Módulo 1** | 1S - 4S | Ligado ao **GND** | `0x48` |
| **Módulo 2** | 5S - 6S | Ligado ao **VDD (3.3V)** | `0x49` |

### 3. Sensor de Corrente (HSTS016L-A) & PWM

⚠️ **Atenção:** O sensor de corrente opera tipicamente a 5V. Como o ESP32 opera a 3.3V, é necessário utilizar um divisor de tensão nas saídas do sensor antes de conectar ao ESP32.

| Sensor / RX | Pino ESP32 (GPIO) | Observação |
| --- | --- | --- |
| **VOUT Sensor** | 35 | Saída de tensão do sensor (Via divisor) |
| **VREF Sensor** | 34 | Tensão de referência (Via divisor) |
| **Sinal PWM (RX)** | 32 | Sinal do Receptor (Canal R84) |

---

## 💻 Instalação e Configuração

### Firmware (ESP32)

1. Abra o arquivo `esp-wifi.ino` na Arduino IDE.
2. Instale as bibliotecas necessárias via Gerenciador de Bibliotecas:
* `ESPAsyncWebServer`
* `AsyncTCP`
* `Adafruit ADS1X15`
* `Adafruit BusIO`


3. Configure suas credenciais WiFi no código:
```cpp
const char* ssid = "SEU_WIFI";
const char* password = "SUA_SENHA";

```


4. Verifique se os valores dos resistores divisores de tensão (bateria e sensor) correspondem ao seu hardware nas definições `#define` e na `struct divisores`.
5. Faça o upload para a ESP32.

### Dashboard (Frontend)

1. O arquivo `dash-14.html` é independente. Você pode abri-lo diretamente no navegador do seu computador ou celular.
2. Certifique-se de que o dispositivo (PC/Celular) esteja na mesma rede WiFi que a ESP32.
3. Insira o IP exibido no Monitor Serial da ESP32 no campo "IP ESP32" do dashboard e clique em **CONECTAR**.

---

## 📊 Como Usar

1. **Monitoramento:** A aba "Monitoramento ao Vivo" mostra os dados em tempo real.
2. **Gravação:** Clique em "INICIAR" para começar a gravar os dados no cartão SD. O LED virtual piscará indicando a gravação.
3. **Download:** Ao parar a gravação, o botão "BAIXAR CSV" aparecerá se o arquivo foi gerado com sucesso.
4. **Análise:** Vá para a aba "Análise de Arquivo", faça o upload do `.csv` baixado e visualize gráficos detalhados de todo o percurso/voo.

---
