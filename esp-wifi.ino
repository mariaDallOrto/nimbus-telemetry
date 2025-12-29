/*
 * TELEMETRIA ESP32 - BACKEND (SEM HTML)
 * - Sensor de Corrente HSTS016L-A
 * - Receptor R84 (PWM)
 * - Monitoramento de Bateria (6S) via ADS1115
 * - Gravação SD Card
 */

#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include "time.h"         
#include "SPI.h"          
#include "SD.h"           
#include <Preferences.h>

// =======================================================
// CONFIGURAÇÃO DA REDE E HORA
// =======================================================
const char* ssid = "K-Torze";        // <--- SEU WIFI
const char* password = "14141414";  // <--- SUA SENHA

const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = -10800; // GMT-3
const int   daylightOffset_sec = 0; 

// =======================================================
// PINAGEM E HARDWARE
// =======================================================
#define PIN_VOUT 35  // Sensor Corrente
#define PIN_VREF 34  // Referência Sensor Corrente
#define PIN_R84  32  // PWM Receptor
#define PIN_SD_CS 5  // SD Card CS

// =======================================================
// CALIBRAÇÃO E MATEMÁTICA
// =======================================================
#define CORRENTE_NOMINAL 200.0
#define TENSAO_VARIACAO 2.0
#define R1_VREF 9.94
#define R2_VREF 17.84
#define R1_VOUT 10.06
#define R2_VOUT 18.02

const float fator_divisor_vref = (R1_VREF + R2_VREF) / R2_VREF;
const float fator_divisor_vout = (R1_VOUT + R2_VOUT) / R2_VOUT;

struct DivisorTensao { float R1; float R2; float fator; };

// Células 1S a 6S
DivisorTensao divisores[6] = {
  {1.319,   3.301, 0},  {5.8891,  3.299, 0},
  {10.599,  3.291, 0},  {15.1393, 3.308, 0},
  {19.670,  3.301, 0},  {24.232,  3.303, 0}
};

// =======================================================
// OBJETOS E VARIÁVEIS GLOBAIS
// =======================================================
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
Adafruit_ADS1115 ads1; // 0x48 (1S-4S)
Adafruit_ADS1115 ads2; // 0x49 (5S-6S)
Preferences preferences;

// Controle de Gravação
bool isRecording = false;
File dataFile;
String currentLogFile;
unsigned long packetCounter = 0;
unsigned long lastTime = 0;
unsigned long lastFlushTime = 0;
const long interval = 250;      // Envio de dados a cada 250ms
const long flushInterval = 5000; // Salvar no SD a cada 5s

// Controle do Receptor R84
enum TipoSinalR84 { UNIDIRECIONAL, BIDIRECIONAL };
TipoSinalR84 tipoSinal = UNIDIRECIONAL; 

// =======================================================
// FUNÇÃO AUXILIAR: DATA/HORA
// =======================================================
String getTimestamp() {
  struct tm timeinfo;
  if(!getLocalTime(&timeinfo)){ return String(millis()); }
  char timeString[25];
  strftime(timeString, sizeof(timeString), "%Y-%m-%dT%H_%M_%S", &timeinfo);
  return String(timeString);
}

// =======================================================
// SETUP INICIAL
// =======================================================
void setup() {
  Serial.begin(115200);
  
  // 1. Configura ADC do ESP32 (para o Sensor de Corrente)
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  pinMode(PIN_R84, INPUT);

  // 2. Calcula fatores dos divisores (Bateria)
  for (int i = 0; i < 6; i++) {
    divisores[i].fator = (divisores[i].R1 + divisores[i].R2) / divisores[i].R2;
  }

  // 3. Inicia I2C e Sensores ADS1115
  Wire.begin(21, 22);
  if (!ads1.begin(0x48)) Serial.println("ERRO: ADS1115 #1 não encontrado");
  if (!ads2.begin(0x49)) Serial.println("ERRO: ADS1115 #2 não encontrado");
  ads1.setGain(GAIN_ONE);
  ads2.setGain(GAIN_ONE);

  // 4. Inicia SD Card
  SPI.begin(18, 19, 23, PIN_SD_CS);
  if (!SD.begin(PIN_SD_CS)) Serial.println("ERRO: SD Card falhou!");

  // 5. Conecta WiFi
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // <--- IMPORTANTE: Desliga economia de energia do WiFi
  WiFi.begin(ssid, password);
  Serial.print("Conectando WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println("\nIP: " + WiFi.localIP().toString());

  // 6. Configura Hora
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);

  // 7. Configura Servidor (Headers CORS para permitir acesso local)
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");

  server.on("/download", HTTP_GET, [](AsyncWebServerRequest *request){
    if (request->hasParam("file")) {
        String fname = request->getParam("file")->value();
        if (SD.exists(fname)) request->send(SD, fname, "text/csv");
        else request->send(404, "text/plain", "Arquivo nao encontrado");
    } else request->send(400);
  });

  ws.onEvent(onWsEvent);
  server.addHandler(&ws);
  server.begin();
  
  Serial.println("Sistema Iniciado! Use o arquivo HTML no PC.");
}

// =======================================================
// LÓGICA PRINCIPAL: LEITURA E ENVIO
// =======================================================
void readSensorsLoop() {
    // --- 1. SENSOR DE CORRENTE ---
    long soma_vref = 0;
    long soma_vout = 0;
    int amostras = 50; 

    for (int i = 0; i < amostras; i++) {
        soma_vref += analogRead(PIN_VREF);
        soma_vout += analogRead(PIN_VOUT);
        delayMicroseconds(50); 
    }
    
    float tensao_esp_vref = ((soma_vref / (float)amostras) / 4095.0) * 3.3;
    float tensao_esp_vout = ((soma_vout / (float)amostras) / 4095.0) * 3.3;
    
    float v_sensor_ref = tensao_esp_vref * fator_divisor_vref;
    float v_sensor_out = tensao_esp_vout * fator_divisor_vout;
    float corrente = ((v_sensor_out - v_sensor_ref) / TENSAO_VARIACAO) * CORRENTE_NOMINAL;

    // --- 2. RECEPTOR R84 (PWM) ---
    unsigned long pulso_r84 = pulseIn(PIN_R84, HIGH, 25000); 
    int valor_pwm = 0;

    if (pulso_r84 > 0) {
        if (tipoSinal == UNIDIRECIONAL) {
            valor_pwm = map(pulso_r84, 1000, 2000, 0, 100);
            valor_pwm = constrain(valor_pwm, 0, 100);
        } else {
            valor_pwm = map(pulso_r84, 1000, 2000, -100, 100);
            valor_pwm = constrain(valor_pwm, -100, 100);
        }
    }

    // --- 3. BATERIA (ADS1115) ---
    float volts_acc[6];
    float volts_cell[6];

    volts_acc[0] = ads1.computeVolts(ads1.readADC_SingleEnded(0)) * divisores[0].fator;
    volts_acc[1] = ads1.computeVolts(ads1.readADC_SingleEnded(1)) * divisores[1].fator;
    volts_acc[2] = ads1.computeVolts(ads1.readADC_SingleEnded(2)) * divisores[2].fator;
    volts_acc[3] = ads1.computeVolts(ads1.readADC_SingleEnded(3)) * divisores[3].fator;
    volts_acc[4] = ads2.computeVolts(ads2.readADC_SingleEnded(0)) * divisores[4].fator;
    volts_acc[5] = ads2.computeVolts(ads2.readADC_SingleEnded(1)) * divisores[5].fator;

    int nCells = 0;
    float vTotal = 0;

    for(int i=0; i<6; i++) {
        if (i == 0) volts_cell[0] = volts_acc[0];
        else volts_cell[i] = volts_acc[i] - volts_acc[i-1];
        
        if(volts_cell[i] < 0) volts_cell[i] = 0;

        if(volts_acc[i] > 0.5) {
             if(volts_cell[i] >= 2.5) nCells = i + 1;
        }
    }
    if(nCells > 0) vTotal = volts_acc[nCells-1];

    // --- 4. PREPARA JSON ---
    packetCounter++;
    String json = "{";
    json += "\"id\":" + String(packetCounter);
    json += ",\"rssi\":" + String(WiFi.RSSI());
    json += ",\"current\":" + String(corrente, 2);
    json += ",\"pwmVal\":" + String(valor_pwm);
    json += ",\"vTotal\":" + String(vTotal, 2);
    json += ",\"nCells\":" + String(nCells);
    for(int i=0; i<6; i++) {
        json += ",\"c" + String(i+1) + "\":" + String(volts_cell[i], 2);
    }
    json += "}";

    ws.textAll(json);

    // --- 5. GRAVAÇÃO SD ---
    if (isRecording && dataFile) {
        // ADICIONADO: String(WiFi.RSSI()) logo após o packetCounter
        String csvLine = getTimestamp() + "," + String(packetCounter) + "," + 
                         String(WiFi.RSSI()) + "," +  // <--- RSSI AQUI
                         String(corrente, 2) + "," + String(valor_pwm) + "," +
                         String(vTotal, 2) + "," + String(nCells);
        
        for(int i=0; i<6; i++) csvLine += "," + String(volts_cell[i], 3);
        
        dataFile.println(csvLine);
        
        // Flush periódico
        if (millis() - lastFlushTime > flushInterval) {
            dataFile.flush();
            lastFlushTime = millis();
        }
    }
}

// =======================================================
// CONTROLE WEBSOCKET
// =======================================================
void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type, void *arg, uint8_t *data, size_t len) {
    if (type == WS_EVT_CONNECT) {
        String stateJson = "{\"type\":\"STATUS\", \"recState\":\"";
        stateJson += isRecording ? "STARTED" : "STOPPED";
        stateJson += "\", \"file\":\"" + currentLogFile + "\"";
        stateJson += ", \"rxMode\":\"" + String(tipoSinal == UNIDIRECIONAL ? "UNIDIRECIONAL" : "BIDIRECIONAL") + "\"}";
        client->text(stateJson);
    }
    else if (type == WS_EVT_DATA) {
        AwsFrameInfo *info = (AwsFrameInfo*)arg;
        if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
            String msg = "";
            for (size_t i = 0; i < len; i++) msg += (char)data[i];
            
            if (msg == "START_RECORD") {
                // REMOVIDA A CRIAÇÃO DE PASTA. GRAVA DIRETO NA RAIZ
                currentLogFile = "/log_" + getTimestamp() + ".csv";
                
                Serial.print("Tentando criar arquivo: ");
                Serial.println(currentLogFile);

                dataFile = SD.open(currentLogFile, FILE_WRITE);
                
                if (dataFile) {
                    Serial.println("Arquivo criado com sucesso!");
                    dataFile.println("Timestamp,PacketID,RSSI_dBm,Corrente_A,Comando_Pct,TensaoTotal_V,Celulas_N,C1,C2,C3,C4,C5,C6");
                    isRecording = true;
                    lastFlushTime = millis();
                    
                    // Avisa o Dashboard que deu certo
                    ws.textAll("{\"type\":\"STATUS\", \"recState\":\"STARTED\", \"file\":\"" + currentLogFile + "\"}");
                } else {
                    Serial.println("ERRO FATAL: Nao foi possivel abrir o arquivo para escrita.");
                    // Avisa o Dashboard que deu erro (opcional, pode aparecer como parado)
                    ws.textAll("{\"type\":\"STATUS\", \"recState\":\"STOPPED\", \"file\":\"ERRO_SD\"}");
                }
            }
            else if (msg == "STOP_RECORD") {
                if (dataFile) { dataFile.flush(); dataFile.close(); }
                isRecording = false;
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
        }
    }
}

void loop() {
    unsigned long now = millis();
    if (now - lastTime > interval) {
        lastTime = now;
        readSensorsLoop();
    }
    ws.cleanupClients();
}
