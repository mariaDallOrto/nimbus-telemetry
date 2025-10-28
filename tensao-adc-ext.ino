#include <Wire.h>
#include <Adafruit_ADS1X15.h> // A mesma biblioteca serve para o ADS1115

// --- Objetos ADS ---
Adafruit_ADS1115 ads1;  // Módulo 1 (0x48) para 1S-4S
Adafruit_ADS1115 ads2;  // Módulo 2 (0x49) para 5S-6S

// =======================================================
// CALIBRAÇÃO DE TENSÃO
// =======================================================

// Assumindo VREF (Ganho) de GAIN_ONE (±4.096V)
// Volts por bit = 4.096 / 32767 = 0.000125
const float VOLTS_POR_BIT_BATERIA = 0.000125F;

// Fatores do Divisor (Baseado na calibração de 3.0V na entrada do ADC)
// Fator = V_max_bateria / 3.0V
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

// =======================================================
// SETUP
// =======================================================

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Iniciando Medidor de Bateria (6S) com 2x ADS1115...");

  // Vamos iniciar o I2C nos pinos 21 (SDA) e 22 (SCL) manualmente
  // ANTES de chamar as bibliotecas.
  Wire.begin(21, 22);
  // ----------------------------------------

  // --- Inicia o Módulo 1 (Endereço Padrão 0x48) ---
  if (!ads1.begin(0x48)) {
    Serial.println("Falha ao encontrar o ADS1115 no endereço 0x48!");
    while (1);
  }
  Serial.println("Módulo 1 (0x48) [1S-4S] encontrado!");
  ads1.setGain(GAIN_ONE); // Ganho fixo para ±4.096V

  // --- Inicia o Módulo 2 (Endereço 0x49) ---
  if (!ads2.begin(0x49)) {
    Serial.println("Falha ao encontrar o ADS1115 no endereço 0x49!");
    while (1);
  }
  Serial.println("Módulo 2 (0x49) [5S-6S] encontrado!");
  ads2.setGain(GAIN_ONE); // Ganho fixo para ±4.096V
  
  Serial.println("\n# Pronto para medir baterias de 1S a 6S.");
  Serial.println("==========================================================");
}

// =======================================================
// LOOP
// =======================================================

void loop() {
  // =============================================
  // LEITURA DAS TENSÕES
  // =============================================
  
  int16_t raw[6];
  float tensoes_totais[6];  // Tensão acumulada (1S, 2S, 3S...)
  float tensoes_celulas[6]; // Tensão individual (C1, C2, C3...)
  
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

  // =============================================
  // CÁLCULO DAS CÉLULAS INDIVIDUAIS
  // =============================================
  tensoes_celulas[0] = tensoes_totais[0];                     // Célula 1 = 1S
  tensoes_celulas[1] = tensoes_totais[1] - tensoes_totais[0]; // Célula 2 = 2S - 1S
  tensoes_celulas[2] = tensoes_totais[2] - tensoes_totais[1]; // Célula 3 = 3S - 2S
  tensoes_celulas[3] = tensoes_totais[3] - tensoes_totais[2]; // Célula 4 = 4S - 3S
  tensoes_celulas[4] = tensoes_totais[4] - tensoes_totais[3]; // Célula 5 = 5S - 4S
  tensoes_celulas[5] = tensoes_totais[5] - tensoes_totais[4]; // Célula 6 = 6S - 5S

  // =============================================
  // DETECÇÃO DE BATERIA (Para exibição limpa)
  // =============================================
  
  // Detecta Tensão Total (última célula conectada)
  // (Define um limite mínimo, ex: 2.5V, para considerar uma bateria conectada)
  float tensao_total_bateria = 0.0;
  int celulas_detectadas = 0;
  for (int i = 5; i >= 0; i--) { // Itera de 6S para 1S
    // Usamos tensoes_totais[i] para a detecção
    if (tensoes_totais[i] > 2.5) { 
      tensao_total_bateria = tensoes_totais[i];
      celulas_detectadas = i + 1; // i=0 -> 1 célula, i=5 -> 6 células
      break; // Para no primeiro que encontrar
    }
  }

  // =============================================
  // EXIBIÇÃO SERIAL
  // =============================================
  Serial.println("--- LEITURA ATUAL ---");
  
  // --- Tensão Total da Bateria ---
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
    // Define um limite inferior de 0V para não mostrar valores negativos
    // (que podem ocorrer se 1S for 4.2V e 2S ler 4.19V por ruído)
    float tensao_celula_limpa = (tensoes_celulas[i] < 0) ? 0.0 : tensoes_celulas[i];
    Serial.print(tensao_celula_limpa, 2);
    Serial.println("V");
  }
  Serial.println(); // Linha em branco

  // --- Informações de Debug (RAW) ---
  Serial.println("--- Debug (RAW e Tensões Totais por Pino) ---");
  Serial.println("Módulo 1 (0x48):");
  Serial.print("  A0 (1S): RAW="); Serial.print(raw[0]); 
  Serial.print("  Tensão="); Serial.print(tensoes_totais[0], 3); Serial.println("V");
  
  Serial.print("  A1 (2S): RAW="); Serial.print(raw[1]); 
  Serial.print("  Tensão="); Serial.print(tensoes_totais[1], 3); Serial.println("V");
  
  Serial.print("  A2 (3S): RAW="); Serial.print(raw[2]); 
  Serial.print("  Tensão="); Serial.print(tensoes_totais[2], 3); Serial.println("V");
  
  Serial.print("  A3 (4S): RAW="); Serial.print(raw[3]); 
  Serial.print("  Tensão="); Serial.print(tensoes_totais[3], 3); Serial.println("V");
  
  Serial.println("\nMódulo 2 (0x49):");
  Serial.print("  A0 (5S): RAW="); Serial.print(raw[4]); 
  Serial.print("  Tensão="); Serial.print(tensoes_totais[4], 3); Serial.println("V");
  
  Serial.print("  A1 (6S): RAW="); Serial.print(raw[5]); 
  Serial.print("  Tensão="); Serial.print(tensoes_totais[5], 3); Serial.println("V");

  Serial.println("==========================================================");

  delay(2000); // Aumentei o delay para 2s para facilitar a leitura no monitor
}
