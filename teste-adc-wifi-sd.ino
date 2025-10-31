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
const long interval = 500;
const long flushInterval = 5000; // Flush a cada 5 segundos

// Variáveis de gravação
bool isRecording = false;
File dataFile;
String currentLogFile;
int writeCounter = 0; // Contador para flush periódico

// =======================================================
// FUNÇÃO: OBTER TIMESTAMP
// =======================================================
String getTimestamp() {
  struct tm timeinfo;
  if(!getLocalTime(&timeinfo)){
    return "1970-01-01T00_00_00"; 
  }
  char timeString[20];
  strftime(timeString, sizeof(timeString), "%Y-%m-%dT%H_%M_%S", &timeinfo);
  return String(timeString);
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
    Serial.println("[SD] Dados sincronizados (flush)");
  }
}

// =======================================================
// FUNÇÕES: CONTROLE DE GRAVAÇÃO SD
// =======================================================
void startSDRecording() {
  if (isRecording) {
    Serial.println("[SD] Gravação já está ativa!");
    return;
  }

  currentLogFile = "/log_" + getTimestamp() + ".csv";
 
  dataFile = SD.open(currentLogFile, FILE_WRITE);
  
  if (!dataFile) {
    Serial.println("[SD] ERRO: Falha ao abrir arquivo!");
    ws.textAll("{\"status\":\"REC_ERROR\", \"msg\":\"Falha ao abrir SD Card\"}");
    return;
  }

  // Escreve o cabeçalho
  dataFile.println("timestamp,id,rssi,total_cells,total_voltage,c1,c2,c3,c4,c5,c6");
  dataFile.flush(); // Garante escrita imediata
  
  // Salva o estado de gravação
  preferences.begin("datalogger", false);
  preferences.putBool("isRecording", true);
  preferences.putString("logFile", currentLogFile);
  preferences.end();

  isRecording = true;
  writeCounter = 0;
  lastFlushTime = millis();
  
  Serial.println("[SD] Gravação iniciada: " + currentLogFile);
  ws.textAll("{\"status\":\"REC_STARTED\", \"file\":\"" + currentLogFile + "\"}");
}

void stopSDRecording() {
  if (!isRecording) {
    Serial.println("[SD] Nenhuma gravação ativa!");
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
  Serial.println("[SD] Gravação parada: " + currentLogFile);
  ws.textAll("{\"status\":\"REC_STOPPED\", \"file\":\"" + currentLogFile + "\"}");
}

// =======================================================
// FUNÇÃO: EVENTOS WEBSOCKET
// =======================================================
void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type,
             void *arg, uint8_t *data, size_t len) {
    
    switch (type) {
        case WS_EVT_CONNECT:
            Serial.printf("[WS] Cliente #%u conectado de %s\n", 
                         client->id(), client->remoteIP().toString().c_str());
            // Envia estado atual da gravação
            if (isRecording) {
              client->text("{\"status\":\"REC_STARTED\", \"file\":\"" + currentLogFile + "\"}");
            }
            break;
            
        case WS_EVT_DISCONNECT:
            Serial.printf("[WS] Cliente #%u desconectado\n", client->id());
            break;
        
        case WS_EVT_DATA: {
            AwsFrameInfo *info = (AwsFrameInfo*)arg;
            if (info->final && info->index == 0 && info->len == len && info->opcode == WS_TEXT) {
              String msg = "";
              for (size_t i = 0; i < len; i++) { msg += (char)data[i]; }
              Serial.printf("[WS] Comando do Cliente #%u: %s\n", client->id(), msg.c_str());

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
// FUNÇÃO: LER SENSORES, ENVIAR E GRAVAR
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
    long currentRssi = WiFi.RSSI();
    String currentTimestamp = getTimestamp();

    // --- 5. MONTA O JSON ---
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

    // --- 6. ENVIA PARA WEBSOCKET ---
    ws.textAll(jsonString);

    // --- 7. GRAVA NO SD CARD (se estiver gravando) ---
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
}

// =======================================================
// FUNÇÃO: HANDLER DE DOWNLOAD HTTP
// =======================================================
void handleDownload(AsyncWebServerRequest *request) {
  if (request->hasParam("file")) {
    String filename = request->getParam("file")->value();
    
    if (SD.exists(filename)) {
      Serial.println("[HTTP] Enviando arquivo: " + filename);
      File downloadFile = SD.open(filename, "r");
      request->send(downloadFile, filename, "text/csv");
      return;
    } else {
      Serial.println("[HTTP] Arquivo não encontrado: " + filename);
      request->send(404, "text/plain", "Arquivo não encontrado");
    }
  } else {
    request->send(400, "text/plain", "Parâmetro 'file' ausente");
  }
}

// =======================================================
// SETUP - MANTENDO ORDEM ORIGINAL
// =======================================================
void setup() {
    Serial.begin(115200);
    delay(300); // MANTIDO: delay original
    
    Serial.println("\n==========================================================");
    Serial.println("ESP32 Battery Monitor (6S) - Versão Robusta");
    Serial.println("==========================================================\n");
    
    // --- 1. INICIA I2C E SENSORES (IGUAL AO ORIGINAL) ---
    Serial.println("Iniciando I2C e Sensores ADS1115...");
    Wire.begin(21, 22);
    
    if (!ads1.begin(0x48)) { 
      Serial.println("ERRO: Falha ao encontrar o ADS1115 (0x48)!");
      while (1);
    }
    Serial.println("Módulo 1 (0x48) [1S-4S] encontrado!");
    ads1.setGain(GAIN_ONE);
    
    if (!ads2.begin(0x49)) { 
      Serial.println("ERRO: Falha ao encontrar o ADS1115 (0x49)!");
      while (1);
    }
    Serial.println("Módulo 2 (0x49) [5S-6S] encontrado!");
    ads2.setGain(GAIN_ONE);

    // --- 2. INICIA SD CARD (IGUAL AO ORIGINAL) ---
    Serial.println("Iniciando Barramento SPI...");
    SPI.begin(18, 19, 23); // SCK, MISO, MOSI
    delay(100); // ADICIONADO: pequeno delay após SPI.begin()
    
    Serial.print("Iniciando Módulo SD Card (CS no pino ");
    Serial.print(chipSelect);
    Serial.println(")...");
    
    if (!SD.begin(chipSelect)) {
        Serial.println("ERRO: Falha na inicialização do SD Card!");
        Serial.println("Verifique:");
        Serial.println("- Conexões físicas (MISO, MOSI, SCK, CS)");
        Serial.println("- Cartão inserido corretamente");
        Serial.println("- Formatação do cartão (FAT32)");
        while (1);
    }
    Serial.println("SD Card inicializado com sucesso.");
    
    // Testa escrita no SD
    Serial.print("Testando escrita no SD Card... ");
    File testFile = SD.open("/test.txt", FILE_WRITE);
    if (testFile) {
        testFile.println("teste");
        testFile.close();
        SD.remove("/test.txt");
        Serial.println("OK!");
    } else {
        Serial.println("FALHOU!");
        Serial.println("ERRO: Não foi possível escrever no SD Card!");
        while(1);
    }

    // --- 3. CONECTA AO WI-FI (IGUAL AO ORIGINAL) ---
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);
    Serial.print("Conectando ao Wi-Fi");
    
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    
    Serial.println("\nConectado!");
    Serial.print("Endereço IP: ");
    Serial.println(WiFi.localIP());

    // --- 4. SINCRONIZA HORA (IGUAL AO ORIGINAL) ---
    Serial.println("Sincronizando relógio com NTP...");
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer); 
    
    struct tm timeinfo;
    Serial.print("Aguardando sincronia de hora");
    int retry_count = 0;
    while (!getLocalTime(&timeinfo) && retry_count < 60) {
        Serial.print(".");
        delay(500);
        retry_count++;
    }
    
    if (retry_count >= 60) {
        Serial.println("\nAVISO: Falha ao obter hora do NTP!");
        Serial.println("A gravação usará timestamp incorreto (1970).");
    } else {
        Serial.print("\nHorário sincronizado: ");
        Serial.println(getTimestamp());
    }

    // --- 5. VERIFICA GRAVAÇÃO ANTERIOR (NOVA FUNCIONALIDADE) ---
    preferences.begin("datalogger", true);
    isRecording = preferences.getBool("isRecording", false);
    
    if (isRecording) {
        currentLogFile = preferences.getString("logFile", "");
        Serial.println("\n*** RECUPERAÇÃO DE GRAVAÇÃO DETECTADA ***");
        
        if (currentLogFile != "" && SD.exists(currentLogFile)) {
            Serial.println("Reabrindo arquivo: " + currentLogFile);
            
            dataFile = SD.open(currentLogFile, FILE_WRITE);
            
            if (dataFile) {
                // Vai para o final do arquivo
                dataFile.seek(dataFile.size());
                // Marca o reboot
                dataFile.println("# REBOOT," + String(millis()) + ",0,0,0,0,0,0,0,0");
                dataFile.flush();
                Serial.println("Gravação retomada com sucesso!");
            } else {
                Serial.println("ERRO: Não foi possível reabrir o arquivo!");
                isRecording = false;
            }
        } else {
            Serial.println("ERRO: Arquivo anterior não encontrado. Resetando estado.");
            isRecording = false;
        }
    }
    preferences.end();

    // --- 6. CONFIGURA SERVIDOR WEB (IGUAL AO ORIGINAL) ---
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
    
    Serial.println("Servidor WebSocket e HTTP iniciados.");
    Serial.println("==========================================================\n");
}

// =======================================================
// LOOP
// =======================================================
void loop() {
    unsigned long now = millis();
    
    if (now - lastTime > interval) {
        lastTime = now;
        readSensorsAndSend();
    }
    
    ws.cleanupClients();
}
