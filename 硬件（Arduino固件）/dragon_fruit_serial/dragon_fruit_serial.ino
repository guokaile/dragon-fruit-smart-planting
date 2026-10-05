/*
 * ================================================================
 *  北方寒旱火龙果智能种植舱 - Arduino 固件 (USB 串口版)
 * ================================================================
 *
 *  硬件接线：
 *
 *    传感器：
 *      DHT11 温湿度传感器  →  数字引脚 D2
 *      土壤湿度传感器      →  模拟引脚 A0
 *      光敏电阻模块        →  模拟引脚 A1
 *
 *    执行器（通过 2 路继电器模块控制）：
 *      雾化加湿器  →  继电器 IN1 → 数字引脚 D3
 *      LED 补光灯  →  继电器 IN2 → 数字引脚 D4
 *
 *    显示屏：
 *      0.96寸 OLED (I2C)  →  SDA → A4, SCL → A5
 *
 *    通信：
 *      Arduino 自带 USB 口（不需要任何额外模块！）
 *      用 USB 线连电脑或手机即可
 *
 *  通信协议（串口波特率 9600）：
 *    发送命令（电脑/手机 → Arduino）：
 *      READ          → 读取所有传感器数据
 *      LIGHT_ON      → 打开补光灯
 *      LIGHT_OFF     → 关闭补光灯
 *      ATOMIZER_ON   → 打开雾化器
 *      ATOMIZER_OFF  → 关闭雾化器
 *      AUTO          → 切换自动模式
 *      MANUAL        → 切换手动模式
 *      SOIL_TH:50    → 设置土壤湿度阈值（0-100）
 *      LIGHT_TH:30   → 设置光照阈值（0-100）
 *
 *    返回数据（Arduino → 电脑/手机）：
 *      JSON 格式，例如：
 *      {"T":26.5,"H":68,"S":45,"L":25,"lightOn":0,"mistOn":1}
 *
 *  需要安装的 Arduino 库：
 *    1. DHT sensor library（搜索 "DHT"）
 *    2. Adafruit SSD1306
 *    3. Adafruit GFX Library
 * ================================================================
 */

// ============== 引入库 ==============
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ============== 引脚定义 ==============
#define DHT_PIN     2     // DHT11 数据线
#define DHT_TYPE    DHT11
#define SOIL_PIN    A0    // 土壤湿度
#define LIGHT_PIN   A1    // 光敏电阻
#define RELAY_MIST  3     // 雾化器继电器
#define RELAY_LIGHT 4     // 补光灯继电器

// ============== OLED 设置 ==============
#define SCREEN_W 128
#define SCREEN_H 64
#define OLED_ADDR 0x3C
Adafruit_SSD1306 display(SCREEN_W, SCREEN_H, &Wire, -1);

// ============== DHT 设置 ==============
DHT dht(DHT_PIN, DHT_TYPE);

// ============== 全局变量 ==============
float temperature  = 25.0;   // 空气温度 °C
float humidity     = 60.0;   // 空气湿度 %
int   soilMoisture = 50;     // 土壤湿度 %
int   lightLevel   = 40;     // 光照强度 %

bool  lightState = false;    // 补光灯状态
bool  mistState  = false;    // 雾化器状态

// 阈值（可被串口命令修改）
int soilThreshold  = 50;     // 土壤湿度低于此值 → 开雾化器
int lightThreshold = 40;     // 光照低于此值 → 开补光灯

// 模式
bool autoMode = true;

// 定时上报
unsigned long lastReport = 0;
const unsigned long REPORT_INTERVAL = 20000;  // 每 2 秒自动上报一次

// ============== 初始化 ==============
void setup() {
  Serial.begin(9600);           // USB 串口
  dht.begin();                  // 温湿度传感器

  // 继电器引脚
  pinMode(RELAY_MIST, OUTPUT);
  pinMode(RELAY_LIGHT, OUTPUT);
  // 继电器模块通常低电平触发：HIGH=关闭，LOW=打开
  digitalWrite(RELAY_MIST, HIGH);
  digitalWrite(RELAY_LIGHT, HIGH);

  // OLED 初始化
  if (display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    showWelcome();
  }

  Serial.println(F("READY:Dragon Fruit IoT System"));
  Serial.println(F("命令: READ / LIGHT_ON / LIGHT_OFF / ATOMIZER_ON / ATOMIZER_OFF / AUTO / MANUAL"));
}

// ============== 主循环 ==============
void loop() {
  // 1. 读传感器
  readSensors();

  // 2. 自动模式控制
  if (autoMode) {
    autoControl();
  }

  // 3. 处理串口命令
  handleSerialCommand();

  // 4. 定时上报数据
  if (millis() - lastReport >= REPORT_INTERVAL) {
    sendData();
    updateOLED();
    lastReport = millis();
  }

  delay(100);
}

// ============== 读取传感器 ==============
void readSensors() {
  // DHT11（可能偶尔读取失败，做保护）
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (!isnan(t)) temperature = t;
  if (!isnan(h)) humidity = h;

  // 土壤湿度传感器（模拟值 0-1023 → 0-100%）
  // ⚠️ 不同传感器校准值不同，实测传感器调整：
  //   干土时读到的值
  //   湿土时读到的值
  int soilRaw = analogRead(SOIL_PIN);
  soilMoisture = map(soilRaw, 55, 90, 0, 100);
  soilMoisture = constrain(soilMoisture, 0, 100);
  // Serial.println(soilRaw);

  // 光敏电阻（模拟值 0-1023 → 0-100%）
  // 光敏电阻值越小光照越强，所以反转映射
  int lightRaw = analogRead(LIGHT_PIN);
  lightLevel = map(lightRaw, 1023, 0, 0, 100);
  lightLevel = constrain(lightLevel, 0, 100);
}

// ============== 自动控制 ==============
void autoControl() {
  // 土壤太干 → 开雾化器
  if (soilMoisture >= soilThreshold && !mistState) {
    setMist(false);
  } else if (soilMoisture < soilThreshold && !mistState) {
    setMist(true);
  }

  // 光照不足 → 开补光灯
  if (lightLevel >= lightThreshold && !lightState) {
    setLight(false);
  } else if (lightLevel < lightThreshold && !lightState) {
    setLight(true);
  }
}

// ============== 串口命令处理 ==============
void handleSerialCommand() {
  while (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    cmd.toUpperCase();

    if (cmd.length() == 0) return;

    if (cmd == "READ") {
      sendData();
    }
    else if (cmd == "LIGHT_ON") {
      autoMode = false;
      setLight(true);
      sendData();
    }
    else if (cmd == "LIGHT_OFF") {
      autoMode = false;
      setLight(false);
      sendData();
    }
    else if (cmd == "ATOMIZER_ON") {
      autoMode = false;
      setMist(true);
      sendData();
    }
    else if (cmd == "ATOMIZER_OFF") {
      autoMode = false;
      setMist(false);
      sendData();
    }
    else if (cmd == "AUTO") {
      autoMode = true;
      Serial.println(F("OK:AUTO"));
    }
    else if (cmd == "MANUAL") {
      autoMode = false;
      Serial.println(F("OK:MANUAL"));
    }
    else if (cmd.startsWith("SOIL_TH:")) {
      soilThreshold = cmd.substring(8).toInt();
      soilThreshold = constrain(soilThreshold, 0, 100);
      Serial.print(F("OK:SOIL_TH="));
      Serial.println(soilThreshold);
    }
    else if (cmd.startsWith("LIGHT_TH:")) {
      lightThreshold = cmd.substring(9).toInt();
      lightThreshold = constrain(lightThreshold, 0, 100);
      Serial.print(F("OK:LIGHT_TH="));
      Serial.println(lightThreshold);
    }
    else {
      Serial.print(F("ERR:UNKNOWN "));
      Serial.println(cmd);
    }
  }
}

// ============== 控制设备 ==============
void setLight(bool on) {
  lightState = on;
  // 低电平触发继电器：LOW=开，HIGH=关
  // ⚠️ 如果继电器是高电平触发，把 LOW/HIGH 对调
  digitalWrite(RELAY_LIGHT, on ? LOW : HIGH);
}

void setMist(bool on) {
  mistState = on;
  digitalWrite(RELAY_MIST, on ? LOW : HIGH);
}

// ============== 发送 JSON 数据 ==============
void sendData() {
  // {"T":26.5,"H":68,"S":45,"L":25,"lightOn":0,"mistOn":1}
  Serial.print(F("{\"T\":"));//环境温度
  Serial.print(temperature, 1);
  Serial.print(F(",\"H\":"));//环境湿度
  Serial.print((int)humidity);
  Serial.print(F(",\"S\":"));//土壤湿度
  Serial.print(soilMoisture);
  Serial.print(F(",\"L\":"));//光照强度
  Serial.print(lightLevel);
  Serial.print(F(",\"lightOn\":"));
  Serial.print(lightState ? 1 : 0);
  Serial.print(F(",\"mistOn\":"));
  Serial.print(mistState ? 1 : 0);
  Serial.println(F("}"));
}

// ============== OLED 显示 ==============
void showWelcome() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(20, 10);
  display.println(F("Dragon Fruit"));
  display.setCursor(15, 25);
  display.println(F("IoT System Ready"));
  display.setCursor(30, 45);
  display.println(F("USB Connected"));
  display.display();
  delay(1500);
}

void updateOLED() {
  display.clearDisplay();
  display.setTextSize(1);

  // 标题
  display.setCursor(0, 0);
  display.println(F("Dragon Fruit Monitor"));
  display.drawLine(0, 9, 128, 9, SSD1306_WHITE);

  // 第一行：温度 + 湿度
  display.setCursor(0, 13);
  display.print(F("T:"));
  display.print(temperature, 1);
  display.print(F("C  H:"));
  display.print((int)humidity);
  display.println(F("%"));

  // 第二行：土壤湿度 + 光照
  display.setCursor(0, 25);
  display.print(F("Soil:"));
  display.print(soilMoisture);
  display.print(F("% Li:"));
  display.println(lightLevel);

  // 第三行：设备状态
  display.setCursor(0, 38);
  display.print(F("LED:"));
  display.print(lightState ? F("ON") : F("OFF"));
  display.print(F(" Mist:"));
  display.println(mistState ? F("ON ") : F("OFF"));

  // 第四行：模式
  display.setCursor(0, 51);
  display.print(F("Mode:"));
  display.print(autoMode ? F("AUTO") : F("MANUAL"));
  display.print(F(" TH:"));
  display.print(soilThreshold);
  display.print(F("/"));
  display.println(lightThreshold);

  display.display();
}
