// =======================================================
// BIBLIOTECAS
// =======================================================
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>
#include "time.h"         
#include "SPI.h"          
#include "SD.h"           
#include <Preferences.h>

// =======================================================
// CONFIGURAÇÃO DA REDE
// =======================================================
const char* ssid = "ThundeRatz";
const char* password = "CapitaoVasco";

// =======================================================
// CONFIGURAÇÃO DO SD CARD (PINO CS)
// =======================================================
const int chipSelect = 5;

// =======================================================
// CONFIGURAÇÃO DE HORA (NTP)
// =======================================================
const char* ntpServer = "a.st1.ntp.br"; 
const long  gmtOffset_sec = -10800; 
const int   daylightOffset_sec = 0; 

// =======================================================
// OBJETOS
// =======================================================
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");
Adafruit_ADS1115 ads1;
Adafruit_ADS1115 ads2;
Preferences preferences;

// =======================================================
// CALIBRAÇÃO DE TENSÃO
// =======================================================
const float MULT_1S = 0.000175;
const float MULT_2S = 0.000350;
const float MULT_3S = 0.000525;
const float MULT_4S = 0.000700;
const float MULT_5S = 0.000875;
const float MULT_6S = 0.001050;

// =======================================================
// VARIÁVEIS GLOBAIS
// =======================================================
unsigned long packetCounter = 0; 
unsigned long lastTime = 0;
unsigned long lastFlushTime = 0;
unsigned long lastWiFiCheck = 0;
const long interval = 500;        // Leitura a cada 500ms
const long flushInterval = 5000;  // Flush a cada 5 segundos
const long wifiCheckInterval = 10000; // Verifica WiFi a cada 10s

// Variáveis de gravação
bool isRecording = false;
File dataFile;
String currentLogFile;
int writeCounter = 0; // Contador para flush periódico

// Estado do WiFi
bool wifiConnected = false;
bool ntpSynced = false;

// =======================================================
// FUNÇÃO: OBTER TIMESTAMP COM FALLBACK
// =======================================================
String getTimestamp() {
  if (!ntpSynced) {
    // Usa millis como timestamp se NTP não estiver sincronizado
    return String(millis());
  }
  
  struct tm timeinfo;
  if(!getLocalTime(&timeinfo)){
    return String(millis()); // Fallback para millis
  }
  
  char timeString[20];
  strftime(timeString, sizeof(timeString), "%Y-%m-%dT%H_%M_%S", &timeinfo);
  return String(timeString);
}

// =======================================================
// FUNÇÃO: TENTAR SINCRONIZAR NTP (NÃO BLOQUEANTE)
// =======================================================
void tryNTPSync() {
  if (wifiConnected && !ntpSynced) {
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      ntpSynced = true;
      Serial.println("NTP sincronizado: " + getTimestamp());
    }
  }
}

// =======================================================
// FUNÇÃO: GERENCIAR CONEXÃO WIFI (NÃO BLOQUEANTE)
// =======================================================
void manageWiFi() {
  unsigned long now = millis();
  
  if (now - lastWiFiCheck < wifiCheckInterval) {
    return; // Ainda não é hora de verificar
  }
  
  lastWiFiCheck = now;
  
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiConnected) {
      wifiConnected = true;
      Serial.println("WiFi reconectado! IP: " + WiFi.localIP().toString());
      tryNTPSync(); // Tenta sincronizar NTP
    }
  } else {
    if (wifiConnected) {
      wifiConnected = false;
      Serial.println("WiFi desconectado! Continuando gravação SD...");
    }
    // Não tenta reconectar - deixa o WiFi fazer isso automaticamente
  }
}

// =======================================================
// FUNÇÕES: CONTROLE DE GRAVAÇÃO SD (MELHORADAS)
// =======================================================
void startSDRecording() {
  if (isRecording) {
    Serial.println("Gravação já está ativa!");
    return;
  }

  currentLogFile = "/log_" + getTimestamp() + ".csv";
 
  dataFile = SD.open(currentLogFile, FILE_WRITE);
  
  if (!dataFile) {
    Serial.println("ERRO: Falha ao abrir arquivo no SD Card!");
    if (wifiConnected) {
      ws.textAll("{\"status\":\"REC_ERROR\", \"msg\":\"Falha ao abrir SD Card\"}");
    }
    return;
  }

  // Escreve o cabeçalho
  dataFile.println("timestamp,id,rssi,total_cells,total_voltage,c1,c2,c3,c4,c5,c6");
  dataFile.flush(); // IMPORTANTE: Garante que o cabeçalho foi escrito
  
  // Salva o estado de gravação
  preferences.begin("datalogger", false);
  preferences.putBool("isRecording", true);
  preferences.putString("logFile", currentLogFile);
  preferences.end();

  isRecording = true;
  writeCounter = 0;
  lastFlushTime = millis();
  
  Serial.println("✓ Gravação iniciada: " + currentLogFile);
  
  if (wifiConnected) {
    ws.textAll("{\"status\":\"REC_STARTED\", \"file\":\"" + currentLogFile + "\"}");
  }
}

void stopSDRecording() {
  if (!isRecording) {
    Serial.println("Nenhuma gravação ativa!");
    return;
  }

  // Flush final antes de fechar
  if (dataFile) {
    dataFile.flush();
    dataFile.close();
  }
  
  // Limpa o estado de gravação
  preferences.begin("datalogger", false);
  preferences.putBool("isRecording", false);
  preferences.putString("logFile", "");
  preferences.end();

  isRecording = false;
  Serial.println("✓ Gravação parada: " + currentLogFile);
  
  if (wifiConnected) {
    ws.textAll("{\"status\":\"REC_STOPPED\", \"file\":\"" + currentLogFile + "\"}");
  }
}

// =======================================================
// FUNÇÃO: FLUSH PERIÓDICO DO SD CARD
// =======================================================
void flushSDCard() {
  if (!isRecording || !dataFile) return;
  
  unsigned long now = millis();
  
  // Flush a cada 5 segundos OU a cada 10 escritas
  if ((now - lastFlushTime > flushInterval) || (writeCounter >= 10)) {
    dataFile.flush();
    lastFlushTime = now;
    writeCounter = 0;
    Serial.println("SD Card: Flush realizado");
  }
}

// =======================================================
// FUNÇÃO: EVENTOS WEBSOCKET
// =======================================================
void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type,
             void *arg, uint8_t *data, size_t len) {
    
    switch (type) {
        case WS_EVT_CONNECT:
            Serial.printf("WebSocket #%u conectado de %s\n", 
                         client->id(), client->remoteIP().toString().c_str());
            // Envia estado atual da gravação
            if (isRecording) {
              client->text("{\"status\":\"REC_STARTED\", \"file\":\"" + currentLogFile + "\"}");
            }
            break;
            
        case WS_EVT_DISCONNECT:
            Serial.printf("WebSocket #%u desconectado\n", client->id());
            break;
        
        case WS_EVT_DATA: {
            AwsFrameInfo *info = (AwsFrameInfo*)arg;
            if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
              String msg = "";
              for (size_t i = 0; i < len; i++) { msg += (char)data[i]; }
              Serial.printf("Comando do Cliente #%u: %s\n", client->id(), msg.c_str());

              if (msg == "START_RECORD") {
                startSDRecording();
              } else if (msg == "STOP_RECORD") {
                stopSDRecording();
              }
            }
            break;
        }
        
        default:
            break;
    }
}

// =======================================================
// FUNÇÃO: LER SENSORES E GRAVAR
// =======================================================
void readSensorsAndSend() {
    
    // --- 1. LEITURA DAS TENSÕES ---
    int16_t raw[6];
    float tensoes_totais[6];  
    float tensoes_celulas[6]; 
    
    raw[0] = ads1.readADC_SingleEnded(0); tensoes_totais[0] = (float)raw[0] * MULT_1S;
    raw[1] = ads1.readADC_SingleEnded(1); tensoes_totais[1] = (float)raw[1] * MULT_2S;
    raw[2] = ads1.readADC_SingleEnded(2); tensoes_totais[2] = (float)raw[2] * MULT_3S;
    raw[3] = ads1.readADC_SingleEnded(3); tensoes_totais[3] = (float)raw[3] * MULT_4S;
    raw[4] = ads2.readADC_SingleEnded(0); tensoes_totais[4] = (float)raw[4] * MULT_5S;
    raw[5] = ads2.readADC_SingleEnded(1); tensoes_totais[5] = (float)raw[5] * MULT_6S;

    // --- 2. CÁLCULO DAS CÉLULAS ---
    tensoes_celulas[0] = tensoes_totais[0];
    tensoes_celulas[1] = tensoes_totais[1] - tensoes_totais[0];
    tensoes_celulas[2] = tensoes_totais[2] - tensoes_totais[1];
    tensoes_celulas[3] = tensoes_totais[3] - tensoes_totais[2];
    tensoes_celulas[4] = tensoes_totais[4] - tensoes_totais[3];
    tensoes_celulas[5] = tensoes_totais[5] - tensoes_totais[4];

    // --- 3. DETECÇÃO DE BATERIA ---
    float tensao_total_bateria = 0.0;
    int celulas_detectadas = 0;
    for (int i = 5; i >= 0; i--) { 
        if (tensoes_totais[i] > 2.5) { 
            tensao_total_bateria = tensoes_totais[i];
            celulas_detectadas = i + 1;
            break; 
        }
    }

    // --- 4. DADOS DE REDE ---
    packetCounter++;
    long currentRssi = wifiConnected ? WiFi.RSSI() : -127;
    String currentTimestamp = getTimestamp();

    // --- 5. GRAVA NO SD PRIMEIRO (PRIORIDADE) ---
    if (isRecording && dataFile) {
      String dataString = currentTimestamp + ",";
      dataString += String(packetCounter) + ",";
      dataString += String(currentRssi) + ",";
      dataString += String(celulas_detectadas) + ",";
      dataString += String(tensao_total_bateria, 2) + ",";
      
      for (int i = 0; i < 6; i++) {
        float tensao_celula_limpa = (tensoes_celulas[i] < 0) ? 0.0 : tensoes_celulas[i];
        dataString += String(tensao_celula_limpa, 2);
        if (i < 5) dataString += ",";
      }
      
      dataFile.println(dataString);
      writeCounter++;
      
      // Flush periódico
      flushSDCard();
    }

    // --- 6. ENVIA PARA WEBSOCKET (se conectado) ---
    if (wifiConnected && ws.count() > 0) {
      String jsonString = "{";
      jsonString += "\"id\":" + String(packetCounter);
      jsonString += ", \"rssi\":" + String(currentRssi);
      jsonString += ", \"total_cells\":" + String(celulas_detectadas);
      jsonString += ", \"total_voltage\":" + String(tensao_total_bateria, 2);
      for (int i = 0; i < 6; i++) {
          float tensao_celula_limpa = (tensoes_celulas[i] < 0) ? 0.0 : tensoes_celulas[i];
          jsonString += ", \"c" + String(i + 1) + "\":" + String(tensao_celula_limpa, 2);
      }
      jsonString += "}";
      
      ws.textAll(jsonString);
    }
}

// =======================================================
// FUNÇÃO: HANDLER DE DOWNLOAD HTTP
// =======================================================
void handleDownload(AsyncWebServerRequest *request) {
  if (request->hasParam("file")) {
    String filename = request->getParam("file")->value();
    
    if (SD.exists(filename)) {
      Serial.println("Enviando arquivo: " + filename);
      File downloadFile = SD.open(filename, "r");
      request->send(downloadFile, filename, "text/csv");
      return;
    } else {
      request->send(404, "text/plain", "Arquivo não encontrado");
    }
  } else {
    request->send(400, "text/plain", "Parâmetro 'file' ausente");
  }
}

// =======================================================
// SETUP (OTIMIZADO E NÃO BLOQUEANTE)
// =======================================================
void setup() {
    Serial.begin(115200);
    delay(500);
    
    Serial.println("\n========================================");
    Serial.println("ESP32 Battery Monitor - Versão Robusta");
    Serial.println("========================================\n");
    
    // --- 1. INICIA I2C E SENSORES ---
    Wire.begin(21, 22);
    
    if (!ads1.begin(0x48)) { 
      Serial.println("ERRO: ADS1115 (0x48) não encontrado!");
      while (1) delay(1000);
    }
    Serial.println("✓ ADS1115 (0x48) inicializado");
    ads1.setGain(GAIN_ONE);
    
    if (!ads2.begin(0x49)) { 
      Serial.println("ERRO: ADS1115 (0x49) não encontrado!");
      while (1) delay(1000);
    }
    Serial.println("✓ ADS1115 (0x49) inicializado");
    ads2.setGain(GAIN_ONE);

    // --- 2. INICIA SD CARD ---
    SPI.begin(18, 19, 23);
    if (!SD.begin(chipSelect)) {
        Serial.println("ERRO: Falha ao inicializar SD Card!");
        while (1) delay(1000);
    }
    Serial.println("✓ SD Card inicializado");

    // --- 3. VERIFICA SE ESTAVA GRAVANDO (RECUPERAÇÃO) ---
    preferences.begin("datalogger", true);
    isRecording = preferences.getBool("isRecording", false);
    
    if (isRecording) {
        currentLogFile = preferences.getString("logFile", "");
        Serial.println("\n! RECUPERAÇÃO DE GRAVAÇÃO DETECTADA !");
        
        if (currentLogFile != "" && SD.exists(currentLogFile)) {
            Serial.println("! Reabrindo arquivo: " + currentLogFile);
            
            dataFile = SD.open(currentLogFile, FILE_APPEND);
            
            if (dataFile) {
                dataFile.println("# REBOOT_" + String(millis()) + ",0,0,0,0,0,0,0,0,0");
                dataFile.flush();
                Serial.println("✓ Gravação retomada com sucesso!");
            } else {
                Serial.println("ERRO: Não foi possível reabrir o arquivo!");
                isRecording = false;
            }
        } else {
            Serial.println("ERRO: Arquivo não encontrado. Resetando estado.");
            isRecording = false;
        }
    }
    preferences.end();

    // --- 4. INICIA WIFI (NÃO BLOQUEANTE) ---
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true); // Reconexão automática
    WiFi.begin(ssid, password);
    
    Serial.print("Conectando ao WiFi");
    int timeout = 0;
    while (WiFi.status() != WL_CONNECTED && timeout < 20) { // Máximo 10s
        delay(500);
        Serial.print(".");
        timeout++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
        wifiConnected = true;
        Serial.println("\n✓ WiFi conectado: " + WiFi.localIP().toString());
        tryNTPSync();
    } else {
        Serial.println("\n! WiFi não conectado (modo offline)");
        Serial.println("! Sistema funcionará sem dashboard");
    }

    // --- 5. CONFIGURA SERVIDOR WEB ---
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");
    
    server.on("/*", HTTP_OPTIONS, [](AsyncWebServerRequest *request){ 
      request->send(200); 
    });
    
    ws.onEvent(onEvent);
    server.addHandler(&ws);
    server.on("/download", HTTP_GET, handleDownload);
    server.begin();
    
    Serial.println("✓ Servidor Web iniciado");
    Serial.println("\n========================================");
    Serial.println("Sistema pronto!");
    Serial.println("========================================\n");
}

// =======================================================
// LOOP (OTIMIZADO)
// =======================================================
void loop() {
    unsigned long now = millis();
    
    // Leitura e gravação (PRIORITÁRIO)
    if (now - lastTime > interval) {
        lastTime = now;
        readSensorsAndSend();
    }
    
    // Gerenciamento de WiFi (secundário)
    manageWiFi();
    
    // Limpeza de clientes WebSocket (se conectado)
    if (wifiConnected) {
        ws.cleanupClients();
    }
    
    // Pequeno delay para não sobrecarregar o processador
    delay(10);
}
