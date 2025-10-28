#include <Wire.h>
#include <Adafruit_ADS1X15.h> // A mesma biblioteca serve para o ADS1115
#include <math.h>             // Para a função sqrt() do RMS
#include <Preferences.h>      // Para salvar a calibração do sensor de corrente

// --- Objetos ADS ---
Adafruit_ADS1115 ads1;  // Módulo 1 (0x48) para 1S-4S
Adafruit_ADS1115 ads2;  // Módulo 2 (0x49) para 5S-6S e Corrente

// =======================================================
// SEÇÃO 1: CALIBRAÇÃO DE TENSÃO (BATERIAS)
// =======================================================

// Ganho GAIN_ONE (±4.096V) -> 0.000125V por bit
const float VOLTS_POR_BIT_BATERIA = 0.000125F;

// Fatores do Divisor (V_max / 3.0V)
const float FATOR_1S = 4.2  / 3.0; // 1.4
const float FATOR_2S = 8.4  / 3.0; // 2.8
const float FATOR_3S = 12.6 / 3.0; // 4.2
const float FATOR_4S = 16.8 / 3.0; // 5.6
const float FATOR_5S = 21.0 / 3.0; // 7.0
const float FATOR_6S = 25.2 / 3.0; // 8.4

// Multiplicadores Finais (RAW -> Tensão Real da Bateria)
const float MULT_1S = VOLTS_POR_BIT_BATERIA * FATOR_1S; // 0.000175
const float MULT_2S = VOLTS_POR_BIT_BATERIA * FATOR_2S; // 0.000350
const float MULT_3S = VOLTS_POR_BIT_BATERIA * FATOR_3S; // 0.000525
const float MULT_4S = VOLTS_POR_BIT_BATERIA * FATOR_4S; // 0.000700
const float MULT_5S = VOLTS_POR_BIT_BATERIA * FATOR_5S; // 0.000875
const float MULT_6S = VOLTS_POR_BIT_BATERIA * FATOR_6S; // 0.001050

// Arrays para armazenar leituras
float tensoes_totais[6];  // Tensão acumulada (1S, 2S, 3S...)
float tensoes_celulas[6]; // Tensão individual (C1, C2, C3...)


// =======================================================
// SEÇÃO 2: LÓGICA DO SENSOR DE CORRENTE (HSTS016L)
// =======================================================

#define RMS_WINDOW_MS 200 // ~12 ciclos em 60 Hz

// Ganho (A/V)
#define SENSOR_RATED_A 200.0f
#define SENSOR_VFS 0.625f // Desvio de ±0.625V
static const float GAIN_A_PER_V_DEFAULT = (SENSOR_RATED_A / SENSOR_VFS); // ≈ 320.0 A/V

// Calibração persistida
Preferences prefs;
float gain_A_per_V = GAIN_A_PER_V_DEFAULT; // A/V
float iOffset_A = 0.0f; // A (subtraído de I_rms)

// Volts por bit para o sensor de corrente
// Usando GAIN_FOUR (±1.024V) para o sinal de ±0.625V
// 1.024V / 32767 = 0.00003125V por bit
const float VOLTS_POR_BIT_CORRENTE = 0.00003125F;

// --- Funções NVS (Salvar/Carregar Calibração) ---
void saveCal() {
  if (prefs.begin("cal", false)) { // "cal" é o nome do "namespace"
    prefs.putFloat("gainAv", gain_A_per_V);
    prefs.putFloat("ioffset", iOffset_A);
    prefs.end();
  }
}
void loadCal() {
  if (prefs.begin("cal", true)) { // true = read-only
    if (prefs.isKey("gainAv")) gain_A_per_V = prefs.getFloat("gainAv", gain_A_per_V);
    if (prefs.isKey("ioffset")) iOffset_A = prefs.getFloat("ioffset", iOffset_A);
    prefs.end();
  }
}

/**
 * Mede o Vrms diferencial entre A2 e A3 do Módulo 2 (ads2)
 * IMPORTANTE: Esta função MUDA o ganho do ads2 para GAIN_FOUR e
 * o restaura para GAIN_ONE antes de sair.
 */
float measureVrmsDiff_ADS1115(uint32_t window_ms = RMS_WINDOW_MS) {
  // 1. Mudar o ganho do Módulo 2 para a leitura de corrente (alta resolução)
  ads2.setGain(GAIN_FOUR); // Faixa de ±1.024V

  double sumsq = 0.0;
  uint32_t n = 0;
  uint32_t t0 = millis();

  while ((millis() - t0) < window_ms) {
    // Lê a diferença (A2 - A3)
    int16_t raw_diff = ads2.readADC_Differential_2_3();
    
    // Converte o valor raw diferencial para volts
    float dv = (float)raw_diff * VOLTS_POR_BIT_CORRENTE; // V
    
    sumsq += (double)dv * (double)dv;
    n++;
    // O ADS1115 é mais lento (max 860 SPS) que o ADC interno.
    // O delayMicroseconds(200) do seu código original é desnecessário,
    // pois o loop já é limitado pela velocidade de leitura do ADS1115.
  }

  // 2. Restaurar o ganho do Módulo 2 para a leitura de tensão (IMPORTANTE)
  ads2.setGain(GAIN_ONE); // Faixa de ±4.096V

  return (n == 0) ? 0.0f : sqrt(sumsq / n);
}

/**
 * Calibra o offset de corrente (zerar) fazendo uma média de 5s
 */
void calibrateZero_5s() {
  Serial.println("\n--- INICIANDO CALIBRACAO DE ZERO (5s) ---");
  Serial.println("--- Certifique-se que nao ha corrente passando! ---");
  
  const uint32_t CAL_MS = 5000;
  uint32_t t0 = millis();
  double acc = 0.0;
  uint32_t samples = 0;
  
  while ((millis() - t0) < CAL_MS) {
    // Chama a nova função de medição do ADS1115
    float vrms = measureVrmsDiff_ADS1115(); 
    float i_rms = vrms * gain_A_per_V;
    acc += i_rms;
    samples++;
    Serial.printf("# CAL %lu Vrms=%.6fV I_rms=%.6fA\n", (unsigned long)samples, vrms, i_rms);
  }
  
  if (samples > 0) {
    iOffset_A = (float)(acc / samples);
    saveCal(); // Salva o novo offset na memória
    Serial.printf("# CAL done. Novo offset: iOffset_A = %.6fA\n", iOffset_A);
  }
  Serial.println("--------------------------------------------");
}

/**
 * Verifica o Serial por comandos (ex: 'c' para calibrar)
 */
void handleSerial() {
  while (Serial.available()) {
    int ch = Serial.read();
    if (ch == 'c' || ch == 'C') {
      calibrateZero_5s();
    }
  }
}

// =======================================================
// SETUP PRINCIPAL
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Iniciando Medidor (Bateria 6S + Corrente) com 2x ADS1115...");

  // Inicia o I2C nos pinos 21 (SDA) e 22 (SCL) manualmente
  Wire.begin(21, 22);

  // --- Inicia o Módulo 1 (0x48) ---
  if (!ads1.begin(0x48)) {
    Serial.println("Falha ao encontrar o ADS1115 no endereço 0x48!");
    while (1);
  }
  Serial.println("Módulo 1 (0x48) [1S-4S] encontrado!");
  ads1.setGain(GAIN_ONE); // Ganho fixo para ±4.096V

  // --- Inicia o Módulo 2 (0x49) ---
  if (!ads2.begin(0x49)) {
    Serial.println("Falha ao encontrar o ADS1115 no endereço 0x49!");
    while (1);
  }
  Serial.println("Módulo 2 (0x49) [5S-6S, Corrente] encontrado!");
  // Define o ganho PADRÃO como GAIN_ONE (para ler tensões)
  ads2.setGain(GAIN_ONE);

  // Carrega a calibração de corrente da memória
  loadCal();
  
  Serial.println("\n# Pronto. Digite 'c' no Serial Monitor para calibrar ZERO (5s).");
  Serial.println("==========================================================");
}

// =======================================================
// LOOP PRINCIPAL
// =======================================================

void loop() {
  // 1. Verifica por comandos (ex: 'c' para calibrar)
  handleSerial();

  // =============================================
  // 2. LEITURA DAS TENSÕES (BATERIAS)
  // =============================================
  
  // Garante que o Módulo 2 está com ganho para BATERIA
  ads2.setGain(GAIN_ONE);

  // Lê Módulo 1 (1S-4S)
  raw[0] = ads1.readADC_SingleEnded(0);
  tensoes_totais[0] = (float)raw[0] * MULT_1S;
  
  raw[1] = ads1.readADC_SingleEnded(1);
  tensoes_totais[1] = (float)raw[1] * MULT_2S;
  
  raw[2] = ads1.readADC_SingleEnded(2);
  tensoes_totais[2] = (float)raw[2] * MULT_3S;
  
  raw[3] = ads1.readADC_SingleEnded(3);
  tensoes_totais[3] = (float)raw[3] * MULT_4S;

  // Lê Módulo 2 (5S-6S)
  raw[4] = ads2.readADC_SingleEnded(0);
  tensoes_totais[4] = (float)raw[4] * MULT_5S;
  
  raw[5] = ads2.readADC_SingleEnded(1);
  tensoes_totais[5] = (float)raw[5] * MULT_6S;

  // Calcula tensões individuais
  tensoes_celulas[0] = tensoes_totais[0];
  tensoes_celulas[1] = tensoes_totais[1] - tensoes_totais[0];
  tensoes_celulas[2] = tensoes_totais[2] - tensoes_totais[1];
  tensoes_celulas[3] = tensoes_totais[3] - tensoes_totais[2];
  tensoes_celulas[4] = tensoes_totais[4] - tensoes_totais[3];
  tensoes_celulas[5] = tensoes_totais[5] - tensoes_totais[4];

  // Detecta Tensão Total (última célula conectada > 2.5V)
  float tensao_total_bateria = 0.0;
  int celulas_detectadas = 0;
  for (int i = 5; i >= 0; i--) { 
    if (tensoes_totais[i] > 2.5) { 
      tensao_total_bateria = tensoes_totais[i];
      celulas_detectadas = i + 1;
      break; 
    }
  }

  // =============================================
  // 3. LEITURA DO SENSOR DE CORRENTE
  // =============================================
  
  // Esta função troca o ganho do ads2 para GAIN_FOUR, lê e restaura para GAIN_ONE
  float vrms = measureVrmsDiff_ADS1115(); 
  
  float i_rms = vrms * gain_A_per_V;
  float i_corr = i_rms - iOffset_A; // Aplica o offset de calibração
  if (i_corr < 0.0) i_corr = 0.0f; // Não mostra corrente negativa
  
  // =============================================
  // 4. EXIBIÇÃO SERIAL
  // =============================================
  Serial.println("--- LEITURA ATUAL ---");
  
  // --- Tensão Total ---
  Serial.print("BATERIA TOTAL (");
  Serial.print(celulas_detectadas);
  Serial.print("S): ");
  Serial.print(tensao_total_bateria, 2);
  Serial.println("V");
  Serial.println(); // Linha em branco

  // --- Tensões Individuais ---
  Serial.println("--- Tensões Individuais ---");
  for (int i = 0; i < celulas_detectadas; i++) {
    Serial.print("  Cel ");
    Serial.print(i + 1);
    Serial.print(": ");
    float tensao_celula_limpa = (tensoes_celulas[i] < 0) ? 0.0 : tensoes_celulas[i];
    Serial.print(tensao_celula_limpa, 2);
    Serial.println("V");
  }
  Serial.println(); // Linha em branco

  // --- Corrente ---
  Serial.println("--- Sensor de Corrente (M2: A2-A3) ---");
  Serial.print("  Corrente RMS: "); Serial.print(i_corr, 3); Serial.println(" A");
  // Linha de debug opcional:
  // Serial.printf("  (Debug: Vrms=%.6fV, I_Raw=%.3fA, Offset=%.3fA)\n", vrms, i_rms, iOffset_A);

  // Linha opcional para Serial Plotter (igual ao seu código original)
  // Serial.printf("%.3f,%.3f,%.3f,%.3f\n",i_rms,i_corr,iOffset_A,vrms);

  Serial.println("==========================================================");

  // Delay do seu código de corrente.
  // Note que a leitura RMS (measureVrmsDiff_ADS1115) já leva 200ms.
  // O loop total levará aprox. 300ms.
  delay(100); 
}
