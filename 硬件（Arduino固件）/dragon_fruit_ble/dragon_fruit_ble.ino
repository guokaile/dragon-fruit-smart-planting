/**
 * 北方寒旱火龙果智能种植舱 - Arduino 固件 (BLE 版)
 * 硬件：Arduino UNO R3 + HM-10 BLE 模块
 * 传感器：DHT11(D2)、土壤湿度(A0)、光敏(A1)
 * 执行器：继电器-雾化器(D3)、继电器-补光灯(D4)
 * 显示：0.96寸 OLED I2C (SDA->A4, SCL->A5)
 */

#include <SoftwareSerial.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ============== 引脚定义 ==============
#define DHT_PIN 2
#define DHT_TYPE DHT11
#define SOIL_PIN A0
#define LIGHT_PIN A1
#define RELAY_ATOMIZER 3
#define RELAY_LIGHT 4

// HM-10 BLE 软串口：RX->10, TX->11
// 注意：HM-10 TX 接 Arduino 10(RX)；HM-10 RX 接 Arduino 11(TX)，建议串 1k/2k 电阻分压 5V->3.3V
#define BLE_RX 10
#define BLE_TX 11

// ============== 对象初始化 ==============
DHT dht(DHT_PIN, DHT_TYPE);
SoftwareSerial ble(BLE_RX, BLE_TX);
Adafruit_SSD1306 display(128, 64, &Wire, -1);

// ============== 状态变量 ==============
float temperature = 0.0;
float humidity = 0.0;
int soilMoisture = 0;     // 0-100%
int lightIntensity = 0;   // 0-100%
bool lightState = false;
bool mistState = false;

// 阈值
int soilThreshold = 50;
int lightThreshold = 30;
int tempThreshold = 35;

// 自动模式
bool autoMode = true;

// 定时上报
unsigned long lastReport = 0;
const unsigned long REPORT_INTERVAL = 2000; // 2秒

void setup() {
  // 初始化串口
  Serial.begin(9600);
  ble.begin(9600);

  // 初始化传感器
  dht.begin();

  // 初始化继电器引脚
  pinMode(RELAY_ATOMIZER, OUTPUT);
  pinMode(RELAY_LIGHT, OUTPUT);
  digitalWrite(RELAY_ATOMIZER, HIGH); // 继电器低电平触发时常用 HIGH=关
  digitalWrite(RELAY_LIGHT, HIGH);

  // 初始化 OLED
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println(F("OLED 初始化失败"));
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println(F("Dragon Fruit IoT"));
  display.println(F("Waiting for BLE..."));
  display.display();

  Serial.println(F("北方寒旱火龙果智能种植舱 已启动"));
  Serial.println(F("命令格式: READ / LIGHT_ON / LIGHT_OFF / ATOMIZER_ON / ATOMIZER_OFF / AUTO / MANUAL"));
}

void loop() {
  readSensors();

  // 自动模式控制
  if (autoMode) {
    if (soilMoisture < soilThreshold && !mistState) {
      setMist(true);
    } else if (soilMoisture >= soilThreshold && mistState) {
      setMist(false);
    }

    if (lightIntensity < lightThreshold && !lightState) {
      setLight(true);
    } else if (lightIntensity >= lightThreshold && lightState) {
      setLight(false);
    }
  }

  // 处理蓝牙/串口命令
  handleCommand(Serial);
  handleCommand(ble);

  // 定时上报
  if (millis() - lastReport >= REPORT_INTERVAL) {
    sendData();
    updateOLED();
    lastReport = millis();
  }

  delay(100);
}

// ============== 读取传感器 ==============
void readSensors() {
  temperature = dht.readTemperature();
  humidity = dht.readHumidity();

  // DHT 读取失败保护
  if (isnan(temperature)) temperature = 25.0;
  if (isnan(humidity)) humidity = 60.0;

  // 土壤湿度：0-1023 映射到 0-100%（根据实际传感器校准）
  int soilRaw = analogRead(SOIL_PIN);
  soilMoisture = map(soilRaw, 1023, 300, 0, 100);
  soilMoisture = constrain(soilMoisture, 0, 100);

  // 光照：0-1023 映射到 0-100%（光敏电阻，值越小光照越强，这里反转）
  int lightRaw = analogRead(LIGHT_PIN);
  lightIntensity = map(lightRaw, 1023, 0, 0, 100);
  lightIntensity = constrain(lightIntensity, 0, 100);
}

// ============== 命令处理 ==============
void handleCommand(Stream &stream) {
  while (stream.available()) {
    String cmd = stream.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();

    if (cmd.length() == 0) continue;

    Serial.print(F("收到命令: "));
    Serial.println(cmd);

    if (cmd == "READ") {
      sendData();
    } else if (cmd == "LIGHT_ON") {
      autoMode = false;
      setLight(true);
      sendData();
    } else if (cmd == "LIGHT_OFF") {
      autoMode = false;
      setLight(false);
      sendData();
    } else if (cmd == "ATOMIZER_ON") {
      autoMode = false;
      setMist(true);
      sendData();
    } else if (cmd == "ATOMIZER_OFF") {
      autoMode = false;
      setMist(false);
      sendData();
    } else if (cmd == "AUTO") {
      autoMode = true;
      stream.println(F("OK:AUTO"));
    } else if (cmd == "MANUAL") {
      autoMode = false;
      stream.println(F("OK:MANUAL"));
    } else if (cmd.startsWith("SOIL_TH:")) {
      soilThreshold = cmd.substring(8).toInt();
      stream.println("OK:SOIL_TH=" + String(soilThreshold));
    } else if (cmd.startsWith("LIGHT_TH:")) {
      lightThreshold = cmd.substring(9).toInt();
      stream.println("OK:LIGHT_TH=" + String(lightThreshold));
    } else {
      stream.println(F("ERR:UNKNOWN_CMD"));
    }
  }
}

// ============== 控制设备 ==============
void setLight(bool on) {
  lightState = on;
  // 假设继电器低电平触发：LOW=开，HIGH=关
  digitalWrite(RELAY_LIGHT, on ? LOW : HIGH);
}

void setMist(bool on) {
  mistState = on;
  digitalWrite(RELAY_ATOMIZER, on ? LOW : HIGH);
}

// ============== 发送数据 ==============
void sendData() {
  String json = "{";
  json += "\"T\":" + String(temperature, 1) + ",";
  json += "\"H\":" + String((int)humidity) + ",";
  json += "\"S\":" + String(soilMoisture) + ",";
  json += "\"L\":" + String(lightIntensity) + ",";
  json += "\"lightOn\":" + String(lightState ? "1" : "0") + ",";
  json += "\"mistOn\":" + String(mistState ? "1" : "0");
  json += "}";

  ble.println(json);
  Serial.println(json);
}

// ============== OLED 显示 ==============
void updateOLED() {
  display.clearDisplay();
  display.setTextSize(1);

  // 标题
  display.setCursor(0, 0);
  display.println(F("Dragon Fruit Monitor"));
  display.drawLine(0, 9, 128, 9, SSD1306_WHITE);

  // 数据行
  display.setCursor(0, 12);
  display.print(F("T:"));
  display.print(temperature, 1);
  display.print(F("C H:"));
  display.print((int)humidity);
  display.println(F("%"));

  display.setCursor(0, 22);
  display.print(F("Soil:"));
  display.print(soilMoisture);
  display.print(F("% Light:"));
  display.println(lightIntensity);

  // 设备状态
  display.setCursor(0, 34);
  display.print(F("LED:"));
  display.print(lightState ? F("ON ") : F("OFF"));
  display.print(F("  Mist:"));
  display.println(mistState ? F("ON ") : F("OFF"));

  // 模式
  display.setCursor(0, 44);
  display.print(F("Mode:"));
  display.println(autoMode ? F("AUTO") : F("MANUAL"));

  // BLE 状态提示
  display.setCursor(0, 54);
  display.print(F("BLE:"));
  display.println(F("HM-10 Ready"));

  display.display();
}
