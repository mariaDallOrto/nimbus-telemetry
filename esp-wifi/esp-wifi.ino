/*
 * TELEMETRIA ESP32 - K-Torze
 *
 * Captura de picos + debug agressivo.
 *
 * Mudancas em relacao a versao antiga (resumo):
 *   - Sensor de corrente: janela curta com min/max/mean (era so mean -> mascarava picos)
 *   - ADS1115 a 860 SPS + I2C 400kHz (6 canais: 48ms -> ~7ms)
 *   - PWM por interrupcao (era pulseIn bloqueante de ate 25ms)
 *   - Taxa de envio 50ms / 20Hz (era 250ms / 4Hz)
 *   - Self-test no boot: I2C scan, ping ADS, R/W do SD, leitura inicial das celulas
 *   - Logs estruturados: [OK] [INFO] [WARN] [ERR] [HEALTH] -> facil de filtrar
 *   - Sanidade automatica: alerta se celula, corrente, PWM, heap ou loop fora do range
 *   - LED de status (GPIO 2): heartbeat lento=OK, medio=REC, rapido=ERRO
 *   - Comandos seriais durante operacao: digite '?' no monitor serial
 *   - WebSocket: envie "DIAG" para receber JSON com saude completa
 *   - HTTP: GET /health retorna JSON resumido (debug pelo celular)
 *
 * Como diagnosticar problemas comuns (na ordem em que aparecem no Serial @ 115200):
 *   - "I2C scan: nenhum dispositivo" -> SDA/SCL invertidos ou modulo ADS sem alimentacao
 *   - "ADS1115 #1 NAO RESPONDE"      -> verificar jumper ADDR=GND (modulo 1)
 *   - "ADS1115 #2 NAO RESPONDE"      -> verificar jumper ADDR=VDD (modulo 2)
 *   - "SD Card NAO montado"          -> verificar SPI, CS, e se o cartao esta FAT32
 *   - "SD R/W test falhou"           -> cartao protegido contra escrita ou corrompido
 *   - "WiFi NAO conectou"            -> SSID/senha errados; sistema continua sem dashboard
 *   - Celulas C5/C6 sempre em 0      -> ADS2 (0x49) provavelmente nao foi detectado
 *   - Corrente em ~0 mesmo com carga -> rodar 'c' (calibrar zero) ou checar divisor de tensao
 *   - PWM val sempre 0               -> 'r' mostra pulso bruto; verificar conexao RX no GPIO 32
 *   - Loop lento (>40ms)             -> reduzir CURRENT_SAMPLES ou checar bloqueio do WiFi
 */

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include "time.h"
#include "SPI.h"
#include "SD.h"

// =========================================================
// CONFIG DE REDE
// =========================================================
const char* ssid             = "ThundeRatz";
const char* password         = "CapitaoVasco";
const char* ntpServer        = "pool.ntp.org";
const long  gmtOffset_sec    = -10800;
const int   daylightOffset_s = 0;

// =========================================================
// PINAGEM (mesma da placa K-Torze)
// =========================================================
#define PIN_VOUT   35   // sensor corrente HSTS016L-A - saida (via divisor)
#define PIN_VREF   34   // sensor corrente HSTS016L-A - referencia (via divisor)
#define PIN_R84    32   // PWM do receptor R84
#define PIN_SD_CS   5   // SD card chip-select (SPI)
#define PIN_LED     2   // LED onboard DevKit V1 - status

// =========================================================
// CALIBRACAO DO SENSOR DE CORRENTE
// =========================================================
#define CORRENTE_NOMINAL  200.0f   // amps nominais do HSTS016L-A
#define TENSAO_VARIACAO     2.0f   // delta V no fundo de escala do sensor
#define R1_VREF   9.94f
#define R2_VREF  17.84f
#define R1_VOUT  10.06f
#define R2_VOUT  18.02f
const float FATOR_VREF = (R1_VREF + R2_VREF) / R2_VREF;
const float FATOR_VOUT = (R1_VOUT + R2_VOUT) / R2_VOUT;

// =========================================================
// DIVISORES PARA AS 6 CELULAS (acumulativos)
// =========================================================
struct DivisorTensao { float R1; float R2; float fator; };
DivisorTensao divisores[6] = {
  { 1.319f,  3.301f, 0},  { 5.8891f, 3.299f, 0},
  {10.599f,  3.291f, 0},  {15.1393f, 3.308f, 0},
  {19.670f,  3.301f, 0},  {24.232f,  3.303f, 0}
};

// =========================================================
// LIMITES DE SANIDADE (geram warnings rate-limited)
// =========================================================
#define CELL_MIN_V        2.50f
#define CELL_MAX_V        4.35f
#define CURRENT_MAX_A   300.0f
#define CURRENT_MIN_A   -50.0f
#define PWM_MIN_US        800
#define PWM_MAX_US       2200
#define HEAP_MIN_KB        30
#define LOOP_BUDGET_PCT    80
#define WARN_INTERVAL_MS 5000

// =========================================================
// TIMING
// =========================================================
const uint32_t TX_INTERVAL_MS     = 50;     // 20 Hz
const uint32_t FLUSH_INTERVAL_MS  = 5000;
const uint32_t HEALTH_INTERVAL_MS = 5000;
const uint16_t CURRENT_SAMPLES    = 100;    // janela do sensor de corrente
const uint32_t PWM_TIMEOUT_MS     = 50;     // sem edge => sinal perdido

// =========================================================
// OBJETOS
// =========================================================
AsyncWebServer  server(80);
AsyncWebSocket  ws("/ws");
Adafruit_ADS1115 ads1;   // 0x48 (celulas 1S..4S)
Adafruit_ADS1115 ads2;   // 0x49 (celulas 5S..6S)

// =========================================================
// ESTADO GLOBAL
// =========================================================
struct Saude {
  bool      ads1Ok;
  bool      ads2Ok;
  bool      sdOk;
  bool      wifiOk;
  bool      ntpOk;
  uint32_t  i2cErr;
  uint32_t  loopLastMs;
  uint32_t  loopMaxMs;
  uint32_t  bootMs;
};
Saude saude = {false, false, false, false, false, 0, 0, 0, 0};

bool       isRecording   = false;
File       dataFile;
String     currentLogFile = "";
uint32_t   packetCounter  = 0;
uint32_t   lastTxMs       = 0;
uint32_t   lastFlushMs    = 0;
uint32_t   lastHealthMs   = 0;
float      currentZeroOffsetA = 0;   // calibrado via comando 'c'

enum TipoSinalR84 { UNIDIRECIONAL, BIDIRECIONAL };
TipoSinalR84 tipoSinal = UNIDIRECIONAL;

// --- PWM via ISR -----------------------------------------
volatile uint32_t pwmRiseUs     = 0;
volatile uint32_t pwmPulseUs    = 0;
volatile uint32_t pwmLastEdgeUs = 0;

void IRAM_ATTR pwmIsr() {
  uint32_t now = micros();
  pwmLastEdgeUs = now;
  if (digitalRead(PIN_R84)) {
    pwmRiseUs = now;
  } else if (pwmRiseUs != 0) {
    pwmPulseUs = now - pwmRiseUs;
  }
}

// --- Ultima leitura (snapshot para diag e sanidade) ------
struct UltimaLeitura {
  float    currentPeak;
  float    currentMean;
  float    currentMin;
  float    vTotal;
  float    cells[6];
  int      nCells;
  int      pwmVal;
  uint32_t pwmPulseUs;
  uint32_t pwmAgeMs;
  long     rssi;
  uint32_t loopMs;
  uint16_t samples;
};
UltimaLeitura ult = {0};

// --- Rate-limit de warnings ------------------------------
struct WarnState {
  uint32_t lastMs;
  bool ready() {
    uint32_t now = millis();
    if (now - lastMs > WARN_INTERVAL_MS) { lastMs = now; return true; }
    return false;
  }
};
WarnState warnCell={0}, warnCurr={0}, warnPwm={0}, warnHeap={0}, warnLoop={0};

// =========================================================
// LOGGING
// =========================================================
#define LOG_OK(msg)   do { Serial.print(F("[OK]   ")); Serial.println(msg); } while(0)
#define LOG_INFO(msg) do { Serial.print(F("[INFO] ")); Serial.println(msg); } while(0)
#define LOG_WARN(msg) do { Serial.print(F("[WARN] ")); Serial.println(msg); } while(0)
#define LOG_ERR(msg)  do { Serial.print(F("[ERR]  ")); Serial.println(msg); } while(0)

String getTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) return String(millis());
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H_%M_%S", &timeinfo);
  return String(buf);
}

// =========================================================
// I2C SCANNER
// =========================================================
void scanI2C() {
  Serial.print(F("[INFO] I2C scan: "));
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      if (found++ > 0) Serial.print(F(", "));
      Serial.print(F("0x")); Serial.print(addr, HEX);
    }
  }
  if (found == 0) Serial.print(F("nenhum dispositivo!"));
  else            { Serial.print(F(" (")); Serial.print(found); Serial.print(F(" devices)")); }
  Serial.println();
}

// =========================================================
// SELF-TEST DO BOOT
// =========================================================
void selfTest() {
  Serial.println();
  Serial.println(F("=========================================="));
  Serial.println(F("  K-TORZE TELEMETRY -- BOOT SELF-TEST"));
  Serial.println(F("=========================================="));

  Serial.printf("[INFO] Pinagem: VOUT=%d VREF=%d PWM=%d SD_CS=%d LED=%d\n",
                PIN_VOUT, PIN_VREF, PIN_R84, PIN_SD_CS, PIN_LED);

  scanI2C();

  // --- ADS1115 ---
  saude.ads1Ok = ads1.begin(0x48);
  saude.ads2Ok = ads2.begin(0x49);
  if (saude.ads1Ok) LOG_OK(F("ADS1115 #1 @ 0x48 (celulas 1S..4S)"));
  else              LOG_ERR(F("ADS1115 #1 @ 0x48 NAO RESPONDE -- jumper ADDR deve estar em GND"));
  if (saude.ads2Ok) LOG_OK(F("ADS1115 #2 @ 0x49 (celulas 5S..6S)"));
  else              LOG_ERR(F("ADS1115 #2 @ 0x49 NAO RESPONDE -- jumper ADDR deve estar em VDD (3V3)"));

  if (saude.ads1Ok) { ads1.setGain(GAIN_ONE); ads1.setDataRate(RATE_ADS1115_860SPS); }
  if (saude.ads2Ok) { ads2.setGain(GAIN_ONE); ads2.setDataRate(RATE_ADS1115_860SPS); }

  // --- SD ---
  SPI.begin(18, 19, 23, PIN_SD_CS);
  saude.sdOk = SD.begin(PIN_SD_CS);
  if (saude.sdOk) {
    uint64_t mb = SD.cardSize() / (1024ULL * 1024ULL);
    Serial.printf("[OK]   SD Card montado: %llu MB, tipo=%d\n", mb, SD.cardType());
    File t = SD.open("/_selftest.tmp", FILE_WRITE);
    if (t) {
      t.println("ok"); t.close();
      File r = SD.open("/_selftest.tmp", FILE_READ);
      if (r && r.readStringUntil('\n') == "ok") {
        LOG_OK(F("SD R/W test"));
        r.close(); SD.remove("/_selftest.tmp");
      } else {
        LOG_WARN(F("SD R/W test falhou (leitura)"));
        if (r) r.close();
      }
    } else {
      LOG_WARN(F("SD R/W test falhou (escrita) -- cartao protegido?"));
    }
  } else {
    LOG_ERR(F("SD Card NAO montado -- checar SPI/CS e formato FAT32"));
  }

  // --- PWM ISR ---
  pinMode(PIN_R84, INPUT);
  attachInterrupt(PIN_R84, pwmIsr, CHANGE);
  LOG_OK(F("PWM interrupt anexada ao GPIO 32 (CHANGE)"));

  // --- leitura inicial das celulas (ajuda a detectar divisor errado) ---
  if (saude.ads1Ok || saude.ads2Ok) {
    LOG_INFO(F("Leitura inicial das celulas:"));
    float acc_prev = 0;
    for (int i = 0; i < 6; i++) {
      Adafruit_ADS1115& ads = (i < 4) ? ads1 : ads2;
      bool ok = (i < 4) ? saude.ads1Ok : saude.ads2Ok;
      if (!ok) { Serial.printf("       C%d: --- (ADS offline)\n", i+1); continue; }
      uint8_t ch = (i < 4) ? i : (i - 4);
      float acc  = ads.computeVolts(ads.readADC_SingleEnded(ch)) * divisores[i].fator;
      float cell = (i == 0) ? acc : acc - acc_prev;
      Serial.printf("       C%d: acumulado=%.3fV celula=%.3fV %s\n",
                    i+1, acc, cell,
                    (cell > CELL_MAX_V) ? "<-- ALTO!" :
                    (cell < 0)          ? "<-- NEGATIVO (divisor invertido?)" : "");
      acc_prev = acc;
    }
  }

  Serial.println(F("=========================================="));
  Serial.print  (F("  RESULTADO: "));
  if (saude.ads1Ok && saude.ads2Ok && saude.sdOk) Serial.println(F("TUDO OK"));
  else                                            Serial.println(F("FALHAS DETECTADAS (veja [ERR] acima)"));
  Serial.println(F("=========================================="));
  Serial.println();
}

// =========================================================
// COMANDOS SERIAIS (ajuda + diag + raw + cal)
// =========================================================
void printHelp() {
  Serial.println(F("---- COMANDOS SERIAIS ----"));
  Serial.println(F("  ?  ajuda"));
  Serial.println(F("  d  diagnostico (saude + ultima leitura)"));
  Serial.println(F("  r  leitura raw (ADC bruto + ADS bruto, uma vez)"));
  Serial.println(F("  s  re-executar self-test"));
  Serial.println(F("  i  scan I2C"));
  Serial.println(F("  z  zera contadores (i2cErr, loopMaxMs, packetCounter)"));
  Serial.println(F("  c  calibra offset do sensor de corrente (SEM corrente circulando)"));
  Serial.println(F("--------------------------"));
}

void printDiag() {
  Serial.println(F("---- DIAGNOSTICO ----"));
  Serial.printf("  uptime=%lus heap=%uKB rssi=%lddBm IP=%s\n",
                (millis() - saude.bootMs) / 1000,
                ESP.getFreeHeap() / 1024,
                WiFi.RSSI(),
                WiFi.localIP().toString().c_str());
  Serial.printf("  saude: ADS1=%d ADS2=%d SD=%d WiFi=%d NTP=%d i2cErr=%u\n",
                saude.ads1Ok, saude.ads2Ok, saude.sdOk, saude.wifiOk, saude.ntpOk, saude.i2cErr);
  Serial.printf("  loop: ultimo=%ums max=%ums alvo=%lums\n",
                saude.loopLastMs, saude.loopMaxMs, TX_INTERVAL_MS);
  float taxa = packetCounter / ((millis() - saude.bootMs) / 1000.0f + 0.001f);
  Serial.printf("  pacotes: total=%u (%.1f Hz medio)\n", packetCounter, taxa);
  Serial.printf("  corrente: pico=%.2fA media=%.2fA min=%.2fA (samples=%u offsetCal=%.2fA)\n",
                ult.currentPeak, ult.currentMean, ult.currentMin, ult.samples, currentZeroOffsetA);
  Serial.printf("  bateria: vTotal=%.2fV nCells=%d\n", ult.vTotal, ult.nCells);
  Serial.print  (F("  celulas: "));
  for (int i = 0; i < 6; i++) Serial.printf("C%d=%.2f ", i+1, ult.cells[i]);
  Serial.println();
  Serial.printf("  pwm: val=%d pulso=%uus idade=%ums\n",
                ult.pwmVal, ult.pwmPulseUs, ult.pwmAgeMs);
  Serial.printf("  gravando=%s arquivo=%s\n",
                isRecording ? "SIM" : "nao", currentLogFile.c_str());
  Serial.println(F("---------------------"));
}

void printRaw() {
  Serial.println(F("---- RAW ----"));
  int raw_vref = analogRead(PIN_VREF);
  int raw_vout = analogRead(PIN_VOUT);
  Serial.printf("  ESP ADC: vref=%4d (%.3fV)  vout=%4d (%.3fV)  delta=%d\n",
                raw_vref, raw_vref * 3.3f / 4095.0f,
                raw_vout, raw_vout * 3.3f / 4095.0f,
                raw_vout - raw_vref);
  if (saude.ads1Ok) {
    for (uint8_t ch = 0; ch < 4; ch++) {
      int16_t r = ads1.readADC_SingleEnded(ch);
      Serial.printf("  ADS1 ch%d: raw=%6d volts=%.4fV celula_calc=%.3fV\n",
                    ch, r, ads1.computeVolts(r),
                    ads1.computeVolts(r) * divisores[ch].fator);
    }
  }
  if (saude.ads2Ok) {
    for (uint8_t ch = 0; ch < 2; ch++) {
      int16_t r = ads2.readADC_SingleEnded(ch);
      Serial.printf("  ADS2 ch%d: raw=%6d volts=%.4fV celula_calc=%.3fV\n",
                    ch, r, ads2.computeVolts(r),
                    ads2.computeVolts(r) * divisores[4+ch].fator);
    }
  }
  noInterrupts();
  uint32_t pulse = pwmPulseUs;
  uint32_t age   = (micros() - pwmLastEdgeUs) / 1000;
  interrupts();
  Serial.printf("  PWM: pulso=%uus ultima_edge=%ums atras\n", pulse, age);
  Serial.println(F("-------------"));
}

void calibrateCurrentZero() {
  Serial.println(F("[CAL] CALIBRACAO DE ZERO - garanta que NAO ha corrente circulando!"));
  Serial.println(F("[CAL] Coletando 2000 amostras..."));
  const int N = 2000;
  double sum_curr = 0;
  for (int i = 0; i < N; i++) {
    float v_ref = analogRead(PIN_VREF) * (3.3f / 4095.0f) * FATOR_VREF;
    float v_out = analogRead(PIN_VOUT) * (3.3f / 4095.0f) * FATOR_VOUT;
    sum_curr += ((v_out - v_ref) / TENSAO_VARIACAO) * CORRENTE_NOMINAL;
  }
  currentZeroOffsetA = sum_curr / N;
  Serial.printf("[CAL] Offset = %.3fA (sera subtraido de todas as leituras)\n", currentZeroOffsetA);
}

void handleSerialCmd() {
  if (!Serial.available()) return;
  char c = Serial.read();
  switch (c) {
    case '?': case 'h': printHelp();             break;
    case 'd':           printDiag();             break;
    case 'r':           printRaw();              break;
    case 's':           selfTest();              break;
    case 'i':           scanI2C();               break;
    case 'c':           calibrateCurrentZero();  break;
    case 'z':
      saude.i2cErr = 0; saude.loopMaxMs = 0; packetCounter = 0;
      LOG_INFO(F("Contadores zerados"));
      break;
    case '\r': case '\n': case ' ': break;
    default:
      Serial.print(F("Comando desconhecido: '")); Serial.print(c);
      Serial.println(F("'. Digite '?' para ajuda."));
  }
}

// =========================================================
// LEITURA DOS SENSORES COM CAPTURA DE PICO
// =========================================================
void readSensors() {
  // --- 1. CORRENTE: loop apertado, conta corrente por amostra, guarda min/max/mean ---
  const float scale = 3.3f / 4095.0f;
  double sum_curr  = 0;
  float  curr_max  = -1e9f;
  float  curr_min  =  1e9f;

  for (uint16_t i = 0; i < CURRENT_SAMPLES; i++) {
    int raw_vref = analogRead(PIN_VREF);
    int raw_vout = analogRead(PIN_VOUT);
    float v_ref = raw_vref * scale * FATOR_VREF;
    float v_out = raw_vout * scale * FATOR_VOUT;
    float curr  = ((v_out - v_ref) / TENSAO_VARIACAO) * CORRENTE_NOMINAL;
    sum_curr += curr;
    if (curr > curr_max) curr_max = curr;
    if (curr < curr_min) curr_min = curr;
  }
  ult.samples     = CURRENT_SAMPLES;
  ult.currentMean = (sum_curr / CURRENT_SAMPLES) - currentZeroOffsetA;
  ult.currentPeak = curr_max - currentZeroOffsetA;
  ult.currentMin  = curr_min - currentZeroOffsetA;

  // --- 2. PWM (do ISR) ---
  noInterrupts();
  uint32_t pulse    = pwmPulseUs;
  uint32_t lastEdge = pwmLastEdgeUs;
  interrupts();
  ult.pwmPulseUs = pulse;
  ult.pwmAgeMs   = (micros() - lastEdge) / 1000;

  ult.pwmVal = 0;
  if (pulse > 0 && ult.pwmAgeMs < PWM_TIMEOUT_MS) {
    if (tipoSinal == UNIDIRECIONAL) {
      ult.pwmVal = constrain((int)map(pulse, 1000, 2000,    0, 100),    0, 100);
    } else {
      ult.pwmVal = constrain((int)map(pulse, 1000, 2000, -100, 100), -100, 100);
    }
  }

  // --- 3. BATERIA (ADS1115 @ 860 SPS) ---
  float volts_acc[6] = {0};
  if (saude.ads1Ok) {
    volts_acc[0] = ads1.computeVolts(ads1.readADC_SingleEnded(0)) * divisores[0].fator;
    volts_acc[1] = ads1.computeVolts(ads1.readADC_SingleEnded(1)) * divisores[1].fator;
    volts_acc[2] = ads1.computeVolts(ads1.readADC_SingleEnded(2)) * divisores[2].fator;
    volts_acc[3] = ads1.computeVolts(ads1.readADC_SingleEnded(3)) * divisores[3].fator;
  }
  if (saude.ads2Ok) {
    volts_acc[4] = ads2.computeVolts(ads2.readADC_SingleEnded(0)) * divisores[4].fator;
    volts_acc[5] = ads2.computeVolts(ads2.readADC_SingleEnded(1)) * divisores[5].fator;
  }

  ult.nCells = 0;
  ult.vTotal = 0;
  for (int i = 0; i < 6; i++) {
    ult.cells[i] = (i == 0) ? volts_acc[0] : (volts_acc[i] - volts_acc[i-1]);
    if (ult.cells[i] < 0) ult.cells[i] = 0;
    if (volts_acc[i] > 0.5f && ult.cells[i] >= 2.5f) ult.nCells = i + 1;
  }
  if (ult.nCells > 0) ult.vTotal = volts_acc[ult.nCells - 1];

  ult.rssi = WiFi.RSSI();
}

// =========================================================
// SANIDADE
// =========================================================
void checkSanity() {
  if (ult.nCells > 0) {
    for (int i = 0; i < ult.nCells; i++) {
      if ((ult.cells[i] > CELL_MAX_V || ult.cells[i] < CELL_MIN_V) && warnCell.ready()) {
        Serial.printf("[WARN] Celula C%d fora do range: %.2fV (esperado %.2f..%.2f)\n",
                      i+1, ult.cells[i], CELL_MIN_V, CELL_MAX_V);
        break;
      }
    }
  }
  if ((ult.currentPeak > CURRENT_MAX_A || ult.currentPeak < CURRENT_MIN_A) && warnCurr.ready()) {
    Serial.printf("[WARN] Corrente pico fora do range: %.1fA (esperado %.0f..%.0f)\n",
                  ult.currentPeak, CURRENT_MIN_A, CURRENT_MAX_A);
  }
  if (ult.pwmPulseUs > 0
      && (ult.pwmPulseUs < PWM_MIN_US || ult.pwmPulseUs > PWM_MAX_US)
      && warnPwm.ready()) {
    Serial.printf("[WARN] PWM pulso fora do range: %uus (esperado %d..%d)\n",
                  ult.pwmPulseUs, PWM_MIN_US, PWM_MAX_US);
  }
  uint32_t heapKb = ESP.getFreeHeap() / 1024;
  if (heapKb < HEAP_MIN_KB && warnHeap.ready()) {
    Serial.printf("[WARN] Heap baixo: %uKB\n", heapKb);
  }
  uint32_t budget = (TX_INTERVAL_MS * LOOP_BUDGET_PCT) / 100;
  if (ult.loopMs > budget && warnLoop.ready()) {
    Serial.printf("[WARN] Loop lento: %ums (orcamento %ums de %lums)\n",
                  ult.loopMs, budget, TX_INTERVAL_MS);
  }
}

// =========================================================
// HEALTH HEARTBEAT (1 linha a cada 5s)
// =========================================================
void printHealth() {
  float taxa = packetCounter / ((millis() - saude.bootMs) / 1000.0f + 0.001f);
  Serial.printf("[HEALTH] up=%lus loop=%u/%lums(max=%u) heap=%uKB rssi=%lddBm pkt=%u rate=%.1fHz pwm_age=%ums i2cErr=%u %s\n",
                (millis() - saude.bootMs) / 1000,
                ult.loopMs, TX_INTERVAL_MS, saude.loopMaxMs,
                ESP.getFreeHeap() / 1024,
                WiFi.RSSI(),
                packetCounter, taxa,
                ult.pwmAgeMs, saude.i2cErr,
                isRecording ? "[REC]" : "");
}

// =========================================================
// LED DE STATUS
// =========================================================
void updateLed() {
  static uint32_t lastToggle = 0;
  static bool     state      = false;
  bool anyError = !saude.ads1Ok || !saude.ads2Ok || !saude.sdOk;
  uint32_t period = anyError ? 100u : (isRecording ? 250u : 1000u);
  uint32_t now = millis();
  if (now - lastToggle >= period) {
    lastToggle = now;
    state = !state;
    // digitalWrite(PIN_LED, state);
  }
}

// =========================================================
// TRANSMISSAO (JSON pelo WS + linha do CSV)
// =========================================================
void doTx() {
  uint32_t t0 = millis();

  readSensors();

  uint32_t loopMs = millis() - t0;
  if (loopMs > saude.loopMaxMs) saude.loopMaxMs = loopMs;
  saude.loopLastMs = loopMs;
  ult.loopMs = loopMs;

  packetCounter++;

  // JSON (snprintf evita fragmentacao de heap a 20Hz)
  static char json[512];
  int n = snprintf(json, sizeof(json),
    "{\"id\":%u,\"rssi\":%ld,"
    "\"current\":%.2f,\"currentMean\":%.2f,\"currentMin\":%.2f,"
    "\"pwmVal\":%d,\"vTotal\":%.2f,\"nCells\":%d,"
    "\"c1\":%.2f,\"c2\":%.2f,\"c3\":%.2f,\"c4\":%.2f,\"c5\":%.2f,\"c6\":%.2f,"
    "\"loopMs\":%u,\"samples\":%u,\"pwmAgeMs\":%u,\"heapKB\":%u,\"i2cErr\":%u}",
    packetCounter, WiFi.RSSI(),
    ult.currentPeak, ult.currentMean, ult.currentMin,
    ult.pwmVal, ult.vTotal, ult.nCells,
    ult.cells[0], ult.cells[1], ult.cells[2],
    ult.cells[3], ult.cells[4], ult.cells[5],
    ult.loopMs, ult.samples, ult.pwmAgeMs,
    ESP.getFreeHeap() / 1024, saude.i2cErr);
  if (n > 0 && n < (int)sizeof(json)) ws.textAll(json);

  // CSV (colunas originais preservadas; extras no fim)
  if (isRecording && dataFile) {
    static char line[256];
    String ts = getTimestamp();
    int m = snprintf(line, sizeof(line),
      "%s,%u,%ld,%.2f,%d,%.2f,%d,%.3f,%.3f,%.3f,%.3f,%.3f,%.3f,%.2f,%.2f,%u,%u",
      ts.c_str(), packetCounter, WiFi.RSSI(),
      ult.currentPeak, ult.pwmVal, ult.vTotal, ult.nCells,
      ult.cells[0], ult.cells[1], ult.cells[2],
      ult.cells[3], ult.cells[4], ult.cells[5],
      ult.currentMean, ult.currentMin, ult.loopMs, ult.pwmAgeMs);
    if (m > 0 && m < (int)sizeof(line)) dataFile.println(line);

    if (millis() - lastFlushMs > FLUSH_INTERVAL_MS) {
      dataFile.flush();
      lastFlushMs = millis();
    }
  }

  checkSanity();
}

// =========================================================
// WEBSOCKET
// =========================================================
void sendDiagWs(AsyncWebSocketClient* cl) {
  static char buf[768];
  snprintf(buf, sizeof(buf),
    "{\"type\":\"DIAG\","
    "\"uptime\":%lu,\"heapKB\":%u,\"rssi\":%ld,"
    "\"ads1\":%d,\"ads2\":%d,\"sd\":%d,\"wifi\":%d,\"ntp\":%d,\"i2cErr\":%u,"
    "\"loopMs\":%u,\"loopMaxMs\":%u,\"loopBudget\":%lu,"
    "\"pktCount\":%u,\"samples\":%u,"
    "\"pwmPulseUs\":%u,\"pwmAgeMs\":%u,\"pwmVal\":%d,"
    "\"currentZero\":%.3f,"
    "\"recording\":%d,\"file\":\"%s\"}",
    (millis() - saude.bootMs) / 1000,
    ESP.getFreeHeap() / 1024, WiFi.RSSI(),
    saude.ads1Ok, saude.ads2Ok, saude.sdOk, saude.wifiOk, saude.ntpOk, saude.i2cErr,
    ult.loopMs, saude.loopMaxMs, TX_INTERVAL_MS,
    packetCounter, ult.samples,
    ult.pwmPulseUs, ult.pwmAgeMs, ult.pwmVal,
    currentZeroOffsetA,
    isRecording ? 1 : 0,
    currentLogFile.c_str());
  if (cl) cl->text(buf); else ws.textAll(buf);
}

void onWsEvent(AsyncWebSocket* /*srv*/, AsyncWebSocketClient* client,
               AwsEventType type, void* arg, uint8_t* data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    String stateJson = "{\"type\":\"STATUS\", \"recState\":\"";
    stateJson += isRecording ? "STARTED" : "STOPPED";
    stateJson += "\", \"file\":\"" + currentLogFile + "\"";
    stateJson += ", \"rxMode\":\"" + String(tipoSinal == UNIDIRECIONAL ? "UNIDIRECIONAL" : "BIDIRECIONAL") + "\"}";
    client->text(stateJson);
    LOG_INFO(F("WebSocket: cliente conectado"));
    return;
  }
  if (type != WS_EVT_DATA) return;

  AwsFrameInfo* info = (AwsFrameInfo*)arg;
  if (!(info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT)) return;

  String msg;
  msg.reserve(len);
  for (size_t i = 0; i < len; i++) msg += (char)data[i];

  if (msg == "START_RECORD") {
    currentLogFile = "/log_" + getTimestamp() + ".csv";
    Serial.print(F("[INFO] Criando arquivo: ")); Serial.println(currentLogFile);
    dataFile = SD.open(currentLogFile, FILE_WRITE);
    if (dataFile) {
      LOG_OK(F("Arquivo criado"));
      dataFile.println(F("Timestamp,PacketID,RSSI_dBm,Corrente_A,Comando_Pct,TensaoTotal_V,Celulas_N,C1,C2,C3,C4,C5,C6,Corrente_Med_A,Corrente_Min_A,LoopMs,PwmIdleMs"));
      isRecording = true;
      lastFlushMs = millis();
      ws.textAll("{\"type\":\"STATUS\", \"recState\":\"STARTED\", \"file\":\"" + currentLogFile + "\"}");
    } else {
      LOG_ERR(F("Falha ao abrir arquivo no SD"));
      ws.textAll("{\"type\":\"STATUS\", \"recState\":\"STOPPED\", \"file\":\"ERRO_SD\"}");
    }
  }
  else if (msg == "STOP_RECORD") {
    if (dataFile) { dataFile.flush(); dataFile.close(); }
    isRecording = false;
    LOG_INFO(F("Gravacao parada"));
    ws.textAll("{\"type\":\"STATUS\", \"recState\":\"STOPPED\", \"file\":\"" + currentLogFile + "\"}");
  }
  else if (msg == "SET_RX_UNI") {
    tipoSinal = UNIDIRECIONAL;
    ws.textAll("{\"type\":\"STATUS\", \"recState\":\"" + String(isRecording?"STARTED":"STOPPED") + "\", \"rxMode\":\"UNIDIRECIONAL\"}");
  }
  else if (msg == "SET_RX_BI") {
    tipoSinal = BIDIRECIONAL;
    ws.textAll("{\"type\":\"STATUS\", \"recState\":\"" + String(isRecording?"STARTED":"STOPPED") + "\", \"rxMode\":\"BIDIRECIONAL\"}");
  }
  else if (msg == "DIAG") {
    sendDiagWs(client);
  }
  else {
    Serial.print(F("[WARN] WS msg desconhecida: ")); Serial.println(msg);
  }
}

// =========================================================
// SETUP / LOOP
// =========================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  saude.bootMs = millis();

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, HIGH);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  for (int i = 0; i < 6; i++) {
    divisores[i].fator = (divisores[i].R1 + divisores[i].R2) / divisores[i].R2;
  }

  Wire.begin(21, 22);
  Wire.setClock(400000);  // I2C fast mode (ADS1115 suporta)

  selfTest();

  // --- WiFi com timeout ---
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid, password);
  Serial.print(F("[INFO] Conectando WiFi"));
  uint32_t wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - wifiStart) < 20000) {
    delay(500); Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    saude.wifiOk = true;
    Serial.printf("[OK]   WiFi conectado: SSID='%s' IP=%s RSSI=%lddBm\n",
                  ssid, WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    LOG_ERR(F("WiFi NAO conectou em 20s -- verifique SSID/senha. Sistema continua sem dashboard."));
  }

  // --- NTP ---
  configTime(gmtOffset_sec, daylightOffset_s, ntpServer);
  struct tm ti;
  if (getLocalTime(&ti, 5000)) {
    saude.ntpOk = true;
    char ts[32]; strftime(ts, sizeof(ts), "%Y-%m-%d %H:%M:%S", &ti);
    Serial.print(F("[OK]   NTP sincronizado: ")); Serial.println(ts);
  } else {
    LOG_WARN(F("NTP nao sincronizou em 5s -- timestamps usarao millis()"));
  }

  // --- HTTP / WS ---
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin",  "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");

  server.on("/download", HTTP_GET, [](AsyncWebServerRequest* req){
    if (req->hasParam("file")) {
      String fname = req->getParam("file")->value();
      if (SD.exists(fname)) req->send(SD, fname, "text/csv");
      else                  req->send(404, "text/plain", "Arquivo nao encontrado");
    } else req->send(400);
  });

  server.on("/health", HTTP_GET, [](AsyncWebServerRequest* req){
    char b[320];
    snprintf(b, sizeof(b),
      "{\"uptime\":%lu,\"heapKB\":%u,\"rssi\":%ld,"
      "\"ads1\":%d,\"ads2\":%d,\"sd\":%d,\"wifi\":%d,\"ntp\":%d,"
      "\"pkt\":%u,\"loopMs\":%u,\"loopMaxMs\":%u,"
      "\"recording\":%d}",
      (millis()-saude.bootMs)/1000, ESP.getFreeHeap()/1024, WiFi.RSSI(),
      saude.ads1Ok, saude.ads2Ok, saude.sdOk, saude.wifiOk, saude.ntpOk,
      packetCounter, ult.loopMs, saude.loopMaxMs,
      isRecording ? 1 : 0);
    req->send(200, "application/json", b);
  });

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.begin();
  LOG_OK(F("HTTP/WS server na porta 80"));
  Serial.println();
  Serial.println(F("Sistema rodando. Digite '?' no Serial Monitor para comandos."));
  Serial.println();
}

void loop() {
  uint32_t now = millis();

  handleSerialCmd();
  updateLed();

  if (now - lastTxMs >= TX_INTERVAL_MS) {
    lastTxMs = now;
    doTx();
  }

  if (now - lastHealthMs >= HEALTH_INTERVAL_MS) {
    lastHealthMs = now;
    printHealth();
  }

  ws.cleanupClients();
}
