#include <Wire.h>
#include <Adafruit_ADS1X15.h>

Adafruit_ADS1115 ads2;  // Módulo 2 (0x49)

// Pinos do ADS1115
const int VOUT_CHANNEL = 2;  // A2
const int VREF_CHANNEL = 3;  // A3

// Parâmetros do sensor HSTS016L (conforme datasheet)
const float RATED_INPUT = 200.0;      // Corrente nominal: ±200A
const float INPUT_RANGE = 250.0;      // Faixa de medição: ±250A
const float RATED_OUTPUT = 2.5;       // Tensão nominal de saída: 2.5V ±0.625V
const float SENSITIVITY = 0.0125;     // Sensibilidade: 2.5V / 200A = 12.5mV/A

// Variáveis de calibração
float offsetVoltage = 0.0;
bool isCalibrated = false;

// Configurações do ADC
const float ADS_VOLTAGE_RANGE = 4.096;  // Ganho configurado (±4.096V)
const int16_t ADS_MAX_VALUE = 32767;    // Valor máximo do ADC (15 bits + sinal)

void setup() {
  Serial.begin(115200);
  while (!Serial) delay(10);
  
  Serial.println("=== Sistema de Leitura HSTS016L ===");
  Serial.println("Inicializando ADS1115...");
  
  // Inicializa o ADS1115 no endereço 0x49
  if (!ads2.begin(0x49)) {
    Serial.println("ERRO: ADS1115 não encontrado!");
    while (1);
  }
  
  // Configura o ganho para ±4.096V (adequado para o sensor)
  ads2.setGain(GAIN_ONE);
  
  Serial.println("ADS1115 inicializado com sucesso!");
  Serial.println("\nComandos disponíveis:");
  Serial.println("  'c' - Calibrar sensor (média de 5s)");
  Serial.println("\nAguardando leituras...\n");
}

void loop() {
  // Verifica se há comando de calibração
  if (Serial.available() > 0) {
    char cmd = Serial.read();
    if (cmd == 'c' || cmd == 'C') {
      calibrateSensor();
    }
  }
  
  // Realiza leitura
  float voltage = readDifferentialVoltage();
  float current = calculateCurrent(voltage);
  
  // Exibe no Serial
  printReadings(voltage, current);
  
  delay(500);  // Atualiza a cada 500ms
}

// Variáveis globais para armazenar leituras ADC cruas
int16_t lastVoutRaw = 0;
int16_t lastVrefRaw = 0;

float readDifferentialVoltage() {
  // Lê Vout (A2)
  lastVoutRaw = ads2.readADC_SingleEnded(VOUT_CHANNEL);
  float vout = (lastVoutRaw * ADS_VOLTAGE_RANGE) / ADS_MAX_VALUE;
  
  // Lê Vref (A3)
  lastVrefRaw = ads2.readADC_SingleEnded(VREF_CHANNEL);
  float vref = (lastVrefRaw * ADS_VOLTAGE_RANGE) / ADS_MAX_VALUE;
  
  // Calcula a diferença (Vout - Vref)
  // Em 0A: diferença ≈ 0V
  // Em +200A: diferença ≈ +2.5V
  float diff = vout - vref;
  
  return diff;
}

float calculateCurrent(float voltage) {
  // Remove o offset de calibração
  // O offset representa pequenas diferenças residuais quando não há corrente
  float calibratedVoltage = voltage - offsetVoltage;
  
  // Converte tensão diferencial para corrente
  // Com Vref como referência:
  // - Em 0A: (Vout - Vref) ≈ 0V
  // - Em +200A: (Vout - Vref) ≈ +2.5V
  // Sensibilidade: 2.5V / 200A = 12.5mV/A = 0.0125V/A
  // Fórmula: I = (Vout - Vref - offset) / 0.0125
  float current = calibratedVoltage / SENSITIVITY;
  
  // Ignora correntes negativas
  if (current < 0) {
    current = 0;
  }
  
  return current;
}

void calibrateSensor() {
  Serial.println("\n========================================");
  Serial.println("    INICIANDO CALIBRAÇÃO");
  Serial.println("========================================");
  Serial.println("Certifique-se de que NÃO há corrente");
  Serial.println("passando pelo sensor!");
  Serial.println("Coletando dados por 5 segundos...\n");
  
  const int CALIBRATION_TIME = 5000;  // 5 segundos
  const int SAMPLE_INTERVAL = 100;    // Amostra a cada 100ms
  const int NUM_SAMPLES = CALIBRATION_TIME / SAMPLE_INTERVAL;
  
  float voltageSum = 0.0;
  int validSamples = 0;
  
  unsigned long startTime = millis();
  
  while (millis() - startTime < CALIBRATION_TIME) {
    float voltage = readDifferentialVoltage();
    voltageSum += voltage;
    validSamples++;
    
    // Feedback visual
    if (validSamples % 10 == 0) {
      Serial.print(".");
    }
    
    delay(SAMPLE_INTERVAL);
  }
  
  // Calcula a média
  offsetVoltage = voltageSum / validSamples;
  isCalibrated = true;
  
  Serial.println("\n\n========================================");
  Serial.println("    CALIBRAÇÃO CONCLUÍDA");
  Serial.println("========================================");
  Serial.print("Amostras coletadas: ");
  Serial.println(validSamples);
  Serial.print("Offset calculado: ");
  Serial.print(offsetVoltage * 1000, 2);
  Serial.println(" mV");
  Serial.println("========================================\n");
}

void printReadings(float voltage, float current) {
  Serial.println("========================================");
  
  // Leituras cruas do ADC
  Serial.println(">> LEITURAS CRUAS ADC:");
  Serial.print("   Vout (A2) RAW:   ");
  Serial.println(lastVoutRaw);
  Serial.print("   Vref (A3) RAW:   ");
  Serial.println(lastVrefRaw);
  Serial.print("   Diferença RAW:   ");
  Serial.println(lastVoutRaw - lastVrefRaw);
  
  Serial.println("\n>> TENSÕES CONVERTIDAS:");
  
  // Tensão diferencial (Vout - Vref)
  Serial.print("   Vout - Vref:     ");
  Serial.print(voltage, 4);
  Serial.print(" V (");
  Serial.print(voltage * 1000, 2);
  Serial.println(" mV)");
  
  // Tensão calibrada (após remover offset)
  if (isCalibrated) {
    float calibratedVoltage = voltage - offsetVoltage;
    Serial.print("   Tensão calibrada: ");
    Serial.print(calibratedVoltage, 4);
    Serial.print(" V (");
    Serial.print(calibratedVoltage * 1000, 2);
    Serial.println(" mV)");
  }
  
  Serial.println("\n>> CORRENTE:");
  Serial.print("   Corrente:        ");
  Serial.print(current, 3);
  Serial.println(" A");
  
  // Status de calibração
  if (!isCalibrated) {
    Serial.println("\n[!] Sistema NÃO calibrado");
    Serial.println("    Pressione 'c' para calibrar");
  }
  
  Serial.println("========================================\n");
}
