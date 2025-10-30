// =======================================================
// BIBLIOTECAS
// =======================================================
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>

// =======================================================
// CONFIGURAÇÃO DA REDE
// =======================================================
const char* ssid = "ThundeRatz";
const char* password = "CapitaoVasco";

// =======================================================
// OBJETOS DO SERVIDOR
// =======================================================
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// =======================================================
// OBJETOS ADS
// =======================================================
Adafruit_ADS1115 ads1;  // Módulo 1 (0x48) para 1S-4S
Adafruit_ADS1115 ads2;  // Módulo 2 (0x49) para 5S-6S

// =======================================================
// CALIBRAÇÃO DE TENSÃO (Copiado do seu código)
// =======================================================
const float VOLTS_POR_BIT_BATERIA = 0.000125F;
const float FATOR_1S = 4.2  / 3.0; // 1.4
const float FATOR_2S = 8.4  / 3.0; // 2.8
const float FATOR_3S = 12.6 / 3.0; // 4.2
const float FATOR_4S = 16.8 / 3.0; // 5.6
const float FATOR_5S = 21.0 / 3.0; // 7.0
const float FATOR_6S = 25.2 / 3.0; // 8.4
const float MULT_1S = VOLTS_POR_BIT_BATERIA * FATOR_1S; // 0.000175
const float MULT_2S = VOLTS_POR_BIT_BATERIA * FATOR_2S; // 0.000350
const float MULT_3S = VOLTS_POR_BIT_BATERIA * FATOR_3S; // 0.000525
const float MULT_4S = VOLTS_POR_BIT_BATERIA * FATOR_4S; // 0.000700
const float MULT_5S = VOLTS_POR_BIT_BATERIA * FATOR_5S; // 0.000875
const float MULT_6S = VOLTS_POR_BIT_BATERIA * FATOR_6S; // 0.001050

// =======================================================
// VARIÁVEIS GLOBAIS
// =======================================================
unsigned long packetCounter = 0; // Nosso contador de pacotes
unsigned long lastTime = 0;
// Intervalo de 500ms (2x por segundo). É mais seguro para 6 leituras I2C.
const long interval = 500; 

// =======================================================
// FUNÇÃO DE EVENTO WEBSOCKET
// =======================================================
void onEvent(AsyncWebSocket *server, AsyncWebSocketClient *client, AwsEventType type,
             void *arg, uint8_t *data, size_t len) {
    
    switch (type) {
        case WS_EVT_CONNECT:
            Serial.printf("Cliente WebSocket #%u conectado do IP: %s\n", client->id(), client->remoteIP().toString().c_str());
            break;
        case WS_EVT_DISCONNECT:
            Serial.printf("Cliente WebSocket #%u desconectado\n", client->id());
            break;
        case WS_EVT_DATA: // Não esperamos dados do cliente
        case WS_EVT_PONG:
        case WS_EVT_ERROR:
            break;
    }
}

// =======================================================
// FUNÇÃO PRINCIPAL: LER SENSORES E ENVIAR DADOS
// =======================================================
void readSensorsAndSend() {
    
    // --- 1. LEITURA DAS TENSÕES (do seu código) ---
    int16_t raw[6];
    float tensoes_totais[6];  
    float tensoes_celulas[6]; 
    
    // Lê Módulo 1 (1S-4S)
    raw[0] = ads1.readADC_SingleEnded(0); tensoes_totais[0] = (float)raw[0] * MULT_1S;
    raw[1] = ads1.readADC_SingleEnded(1); tensoes_totais[1] = (float)raw[1] * MULT_2S;
    raw[2] = ads1.readADC_SingleEnded(2); tensoes_totais[2] = (float)raw[2] * MULT_3S;
    raw[3] = ads1.readADC_SingleEnded(3); tensoes_totais[3] = (float)raw[3] * MULT_4S;
    // Lê Módulo 2 (5S-6S)
    raw[4] = ads2.readADC_SingleEnded(0); tensoes_totais[4] = (float)raw[4] * MULT_5S;
    raw[5] = ads2.readADC_SingleEnded(1); tensoes_totais[5] = (float)raw[5] * MULT_6S;

    // --- 2. CÁLCULO DAS CÉLULAS INDIVIDUAIS (do seu código) ---
    tensoes_celulas[0] = tensoes_totais[0];
    tensoes_celulas[1] = tensoes_totais[1] - tensoes_totais[0];
    tensoes_celulas[2] = tensoes_totais[2] - tensoes_totais[1];
    tensoes_celulas[3] = tensoes_totais[3] - tensoes_totais[2];
    tensoes_celulas[4] = tensoes_totais[4] - tensoes_totais[3];
    tensoes_celulas[5] = tensoes_totais[5] - tensoes_totais[4];

    // --- 3. DETECÇÃO DE BATERIA (do seu código) ---
    float tensao_total_bateria = 0.0;
    int celulas_detectadas = 0;
    for (int i = 5; i >= 0; i--) { 
        if (tensoes_totais[i] > 2.5) { 
            tensao_total_bateria = tensoes_totais[i];
            celulas_detectadas = i + 1;
            break; 
        }
    }

    // --- 4. OBTÉM DADOS DE REDE E PACOTE ---
    packetCounter++;
    long currentRssi = WiFi.RSSI();

    // --- 5. MONTA O JSON ---
    // Usar String do Arduino é mais simples para este caso
    String jsonString = "{";
    jsonString += "\"id\":" + String(packetCounter);
    jsonString += ", \"rssi\":" + String(currentRssi);
    jsonString += ", \"total_cells\":" + String(celulas_detectadas);
    jsonString += ", \"total_voltage\":" + String(tensao_total_bateria, 2); // 2 casas decimais

    // Adiciona as 6 células individuais ao JSON
    for (int i = 0; i < 6; i++) {
        // Limpa valores negativos (ruído) para 0.0
        float tensao_celula_limpa = (tensoes_celulas[i] < 0) ? 0.0 : tensoes_celulas[i];
        jsonString += ", \"c" + String(i + 1) + "\":" + String(tensao_celula_limpa, 2);
    }
    
    jsonString += "}";

    // --- 6. ENVIA O JSON PARA TODOS OS CLIENTES ---
    ws.textAll(jsonString);
}


// =======================================================
// SETUP
// =======================================================
void setup() {
    Serial.begin(115200);
    delay(300);
    
    // --- Inicia I2C e Sensores ---
    Serial.println("Iniciando Medidor de Bateria (6S) com 2x ADS1115...");
    Wire.begin(21, 22); // Pinos I2C personalizados
    
    if (!ads1.begin(0x48)) {
        Serial.println("Falha ao encontrar o ADS1115 no endereço 0x48!");
        while (1);
    }
    Serial.println("Módulo 1 (0x48) [1S-4S] encontrado!");
    ads1.setGain(GAIN_ONE); // Ganho fixo para ±4.096V

    if (!ads2.begin(0x49)) {
        Serial.println("Falha ao encontrar o ADS1115 no endereço 0x49!");
        while (1);
    }
    Serial.println("Módulo 2 (0x49) [5S-6S] encontrado!");
    ads2.setGain(GAIN_ONE); // Ganho fixo para ±4.096V

    // --- Conecta ao Wi-Fi ---
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);
    Serial.print("Conectando ao Wi-Fi...");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\nConectado!");
    Serial.print("Endereço IP: ");
    Serial.println(WiFi.localIP()); // *** ANOTE ESSE IP ***

    // --- Configuração do Servidor WebSocket ---
    // Cabeçalhos CORS para permitir que seu HTML (em file://) acesse
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");
    
    server.on("/*", HTTP_OPTIONS, [](AsyncWebServerRequest *request){
        request->send(200);
    });

    ws.onEvent(onEvent);
    server.addHandler(&ws);

    server.begin();
    Serial.println("Servidor WebSocket (apenas) iniciado.");
    Serial.println("==========================================================");
}

// =======================================================
// LOOP
// =======================================================
void loop() {
    unsigned long now = millis();

    // Timer não-bloqueante
    if (now - lastTime > interval) {
        lastTime = now;
        
        // Chama a função que lê e envia tudo
        readSensorsAndSend();
    }
    
    ws.cleanupClients();
}
