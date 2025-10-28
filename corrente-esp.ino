#include <WiFi.h>

#include <esp_now.h>

#include <esp_wifi.h>

#include <esp_idf_version.h>

#include <Preferences.h>

#include <math.h>



// ===== ESPNOW =====

const int ESPNOW_CHANNEL = 1;

// MAC do RECEPTOR (ajuste se necessário)

uint8_t peerMac[] = { 0x00, 0x4B, 0x12, 0x30, 0xC6, 0x40 };



// ===== HSTS016L - Leitura diferencial =====

#define ADC_VOUT_PIN 34 // VOUT -> GPIO34 (ADC1)

#define ADC_VREF_PIN 33 // VREF -> GPIO33 (ADC1)

#define ADC_REF_V 3.3f

#define ADC_COUNTS 4095.0f

#define RMS_WINDOW_MS 200 // ~12 ciclos em 60 Hz



// ===== Ganho (A/V) =====

// Para HSTS016L 200 A (5 V): desvio plena escala ≈ ±0.625 V

#define SENSOR_RATED_A 200.0f

#define SENSOR_VFS 0.625f

static const float GAIN_A_PER_V_DEFAULT = (SENSOR_RATED_A / SENSOR_VFS); // ≈ 320.0 A/V



// ===== Calibração persistida =====

Preferences prefs;

float gain_A_per_V = GAIN_A_PER_V_DEFAULT; // A/V

float iOffset_A = 0.0f; // A (subtraído de I_rms)



// ===== Payload sem 'packed' (evita o erro do typedef) =====

typedef struct {

uint32_t counter;

float value; // corrente RMS corrigida (A)

} payload_t;



payload_t data = {0, 0.0f};



// ===== Callback de envio (IDF v4/v5) =====

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)

void onSend(const wifi_tx_info_t* info, esp_now_send_status_t status) { (void)info; (void)status; }

#else

void onSend(const uint8_t* mac_addr, esp_now_send_status_t status) { (void)mac_addr; (void)status; }

#endif



bool addPeerIfNeeded() {

if (esp_now_is_peer_exist(peerMac)) return true;

esp_now_peer_info_t peer{};

memcpy(peer.peer_addr, peerMac, 6);

peer.channel = ESPNOW_CHANNEL;

peer.ifidx = WIFI_IF_STA;

peer.encrypt = false;

return esp_now_add_peer(&peer) == ESP_OK;

}



// ===== ADC helpers =====

inline float rawToVolts(int raw) { return (raw * ADC_REF_V) / ADC_COUNTS; }



// Vrms (em VOLTS) da diferença ΔV = VOUT - VREF

float measureVrmsDiff(uint32_t window_ms = RMS_WINDOW_MS) {

double sumsq = 0.0; uint32_t n = 0, t0 = millis();

while ((millis() - t0) < window_ms) {

int raw_out = analogRead(ADC_VOUT_PIN);

int raw_ref = analogRead(ADC_VREF_PIN);

float dv = rawToVolts(raw_out) - rawToVolts(raw_ref); // V

sumsq += (double)dv * (double)dv; n++;

delayMicroseconds(200); // ~5 kHz

}

return (n == 0) ? 0.0f : sqrt(sumsq / n);

}



// ===== NVS =====

void saveCal() {

if (prefs.begin("cal", false)) {

prefs.putFloat("gainAv", gain_A_per_V);

prefs.putFloat("ioffset", iOffset_A);

prefs.end();

}

}

void loadCal() {

if (prefs.begin("cal", true)) {

if (prefs.isKey("gainAv")) gain_A_per_V = prefs.getFloat("gainAv", gain_A_per_V);

if (prefs.isKey("ioffset")) iOffset_A = prefs.getFloat("ioffset", iOffset_A);

prefs.end();

}

}



// ===== Comando 'c' (zerar corrente com média de 5s) =====

void calibrateZero_5s() {

const uint32_t CAL_MS = 5000;

uint32_t t0 = millis(); double acc = 0.0; uint32_t samples = 0;

while ((millis() - t0) < CAL_MS) {

float vrms = measureVrmsDiff();

float i_rms = vrms * gain_A_per_V;

acc += i_rms; samples++;

Serial.printf("# CAL %lu Vrms=%.6fV I_rms=%.6fA\n", (unsigned long)samples, vrms, i_rms);

}

if (samples > 0) {

iOffset_A = (float)(acc / samples);

saveCal();

Serial.printf("# CAL done. iOffset_A=%.6fA\n", iOffset_A);

}

}



// Apenas 'c' no Serial (o Plotter não envia comandos)

void handleSerial() {

while (Serial.available()) {

int ch = Serial.read();

if (ch == 'c' || ch == 'C') calibrateZero_5s();

}

}



void setup() {

Serial.begin(115200);

delay(300);



// ADCs: mesma atenuação nos dois canais

analogReadResolution(12);

analogSetPinAttenuation(ADC_VOUT_PIN, ADC_11db); // use ADC_6db se o sensor for 3,3 V

analogSetPinAttenuation(ADC_VREF_PIN, ADC_11db);

pinMode(ADC_VOUT_PIN, INPUT);

pinMode(ADC_VREF_PIN, INPUT);



// WiFi/ESP-NOW

WiFi.mode(WIFI_STA);

esp_wifi_set_promiscuous(true);

esp_wifi_set_channel(ESPNOW_CHANNEL, WIFI_SECOND_CHAN_NONE);

esp_wifi_set_promiscuous(false);



if (esp_now_init() != ESP_OK) {

Serial.println("# ESP-NOW init FAIL");

while (true) delay(1000);

}

esp_now_register_send_cb(onSend);

if (!addPeerIfNeeded()) {

Serial.println("# add_peer FAIL");

while (true) delay(2000);

}



loadCal();



Serial.println("# Pronto. Digite 'c' no Serial Monitor para calibrar ZERO (5s).");

Serial.println("# Serial Plotter: linhas no formato label:valor.");

}



void loop() {

handleSerial();



data.counter++;



// Medição differential -> Vrms -> A, com offset subtraído

float vrms = measureVrmsDiff();

float i_rms = vrms * gain_A_per_V;

float i_corr = i_rms - iOffset_A;

if (i_corr < 0) i_corr = 0.0f;



data.value = i_corr;



// Linha para o Serial Plotter (quatro séries):

// I_raw(A) I_corr(A) OffsetA(A) Vrms(V)

Serial.printf("%.3f,%.3f,%.3f,%.3f\n",i_rms,i_corr,iOffset_A,vrms);

// Envia ao receptor

esp_now_send(peerMac, (uint8_t*)&data, sizeof(data));



delay(100); // ~10 Hz

}
