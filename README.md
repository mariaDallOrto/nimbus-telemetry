# nimbus-telemetry

Agora vai.

Pino do Módulo SD,Pino da ESP32 (DevKit),Função
3V3,3V3,Alimentação 3.3V
GND,GND,Terra
MISO,GPIO 19,"Master In, Slave Out"
MOSI,GPIO 23,"Master Out, Slave In"
CLK (ou SCK),GPIO 18,Serial Clock (Relógio)
CS,GPIO 5,Chip Select (Padrão VSPI)


ADDR ligado ao GND: Endereço 0x48 (Este é o padrão que usamos até agora)
ADDR ligado ao VDD (3.3V): Endereço 0x49
ADDR ligado ao SDA: Endereço 0x4A
ADDR ligado ao SCL: Endereço 0x4B

Módulo 1: Deixe o ADDR ligado ao GND. (Endereço 0x48)
Módulo 2: Ligue o ADDR ao VDD (3.3V). (Endereço 0x49)

Conexões Compartilhadas (Ambos os módulos):
ESP32 3.3V -> VDD do Módulo 1 E VDD do Módulo 2
ESP32 GND -> GND do Módulo 1 E GND do Módulo 2
ESP32 D22 (SCL) -> SCL do Módulo 1 E SCL do Módulo 2
ESP32 D21 (SDA) -> SDA do Módulo 1 E SDA do Módulo 2

Para o sensor de corrente deve ser usado um divisor de corrente.
