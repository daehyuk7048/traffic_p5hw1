#include <Arduino.h>
#include <PinChangeInterrupt.h>
#include <TaskScheduler.h>

// -------------------- 핀/상수 정의 --------------------
#define RED_LED      9
#define YELLOW_LED   10
#define GREEN_LED    11

#define BTN_EMERGENCY 6
#define BTN_BLINK     7
#define BTN_ONOFF     8

#define POTENTIOMETER A0  

Scheduler runner;

// -------------------- 모드 상태 플래그 --------------------
volatile bool isEmergency = false;
volatile bool isBlinking  = false;
volatile bool isOn        = true;

volatile unsigned long lastButtonPress = 0;

int brightness = 255; // 가변저항 밝기

// -------------------- 함수 선언 --------------------
void ISR_Emergency();
void ISR_Blinking();
void ISR_OnOff();

void LedRedOn();
void LedYellowOn();
void LedGreenOn();
void ToggleGreenBlink();
void LedYellowBlink();

void handleModeChange(String mode);   // p5.js "MODE: ~" 처리
void restartTrafficLight();

// -------------------- 새로 추가: 모드 해제 함수들 --------------------
void disableEmergency();
void disableBlink();
void disableOff();

// -------------------- TaskScheduler 태스크 --------------------
Task taskRed(2000, TASK_FOREVER, &LedRedOn,      &runner, true);
Task taskYellow(500, TASK_FOREVER, &LedYellowOn, &runner, false);
Task taskGreen(2000, TASK_FOREVER, &LedGreenOn,  &runner, false);
Task taskGreenBlink(166, TASK_FOREVER, &ToggleGreenBlink, &runner, false);
Task taskYellowBlink(500, TASK_FOREVER, &LedYellowBlink,  &runner, false);

// 가변저항 측정
void updateBrightness() {
  int potValue = analogRead(POTENTIOMETER);
  int newBrightness = map(potValue, 0, 1023, 0, 255);
  if (newBrightness != brightness) {
    brightness = newBrightness;
    Serial.print("BRIGHTNESS: ");
    Serial.println(brightness);
  }
}
Task taskBrightnessUpdate(100, TASK_FOREVER, &updateBrightness, &runner, true);

// 전체 LED 깜빡임
Task taskBlink(500, TASK_FOREVER, []() {
  static bool state = false;
  state = !state;
  analogWrite(RED_LED,    state ? brightness : 0);
  analogWrite(YELLOW_LED, state ? brightness : 0);
  analogWrite(GREEN_LED,  state ? brightness : 0);
}, &runner, false);

// -------------------- setup() --------------------
void setup() {
  Serial.begin(115200);

  pinMode(RED_LED,    OUTPUT);
  pinMode(YELLOW_LED, OUTPUT);
  pinMode(GREEN_LED,  OUTPUT);

  pinMode(BTN_EMERGENCY, INPUT_PULLUP);
  pinMode(BTN_BLINK,     INPUT_PULLUP);
  pinMode(BTN_ONOFF,     INPUT_PULLUP);

  pinMode(POTENTIOMETER, INPUT);

  attachPCINT(digitalPinToPCINT(BTN_EMERGENCY), ISR_Emergency, FALLING);
  attachPCINT(digitalPinToPCINT(BTN_BLINK),     ISR_Blinking,  FALLING);
  attachPCINT(digitalPinToPCINT(BTN_ONOFF),     ISR_OnOff,     FALLING);

  // 첫 시작: 빨간불
  Serial.println("STATE: RED_ON");
  taskRed.enable();
}

// -------------------- 기본 신호등 로직 --------------------
void LedRedOn() {
  if (!isOn || isEmergency || isBlinking) return;

  Serial.println("STATE: RED_ON");
  analogWrite(RED_LED, brightness);
  analogWrite(YELLOW_LED, 0);
  analogWrite(GREEN_LED,  0);

  taskRed.disable();
  taskYellow.enableDelayed(taskRed.getInterval());
}

void LedYellowOn() {
  if (!isOn || isEmergency || isBlinking) return;

  Serial.println("STATE: YELLOW_ON");
  analogWrite(RED_LED,    0);
  analogWrite(YELLOW_LED, brightness);
  analogWrite(GREEN_LED,  0);

  taskYellow.disable();
  taskGreen.enableDelayed(taskYellow.getInterval());
}

void LedGreenOn() {
  if (!isOn || isEmergency || isBlinking) return;

  Serial.println("STATE: GREEN_ON");
  analogWrite(YELLOW_LED, 0);
  analogWrite(GREEN_LED,  brightness);

  taskGreen.disable();
  taskGreenBlink.enableDelayed(taskGreen.getInterval());
}

// 초록 불 깜빡임
void ToggleGreenBlink() {
  if (!isOn || isEmergency || isBlinking) return;

  static bool state = true;
  static int blinkCount = 0;

  state = !state;
  analogWrite(GREEN_LED, state ? brightness : 0);
  Serial.println("STATE: GREEN_BLINK");
  blinkCount++;

  if (blinkCount >= 6) {
    Serial.println("STATE: YELLOW_ON");
    analogWrite(GREEN_LED, 0);
    blinkCount = 0;

    taskGreenBlink.disable();
    taskYellowBlink.enableDelayed(500);
  }
}

void LedYellowBlink() {
  if (!isOn || isEmergency || isBlinking) return;

  Serial.println("STATE: YELLOW_BLINK");
  analogWrite(YELLOW_LED, brightness);

  taskYellowBlink.disable();
  taskRed.enableDelayed(taskYellowBlink.getInterval());
}

// 신호등 재시작
void restartTrafficLight() {
  Serial.println("STATE: RESET");
  runner.disableAll();

  analogWrite(RED_LED,    0);
  analogWrite(YELLOW_LED, 0);
  analogWrite(GREEN_LED,  0);

  taskRed.enable();
  taskBrightnessUpdate.enable(); // 밝기는 계속 체크
}

// -------------------- (A) 모드 해제 함수들 --------------------
void disableEmergency() {
  if (isEmergency) {
    isEmergency = false;
    // 긴급 OFF
    runner.enableAll();
    restartTrafficLight();
    Serial.println("STATE: EMERGENCY_OFF");
  }
}

void disableBlink() {
  if (isBlinking) {
    isBlinking = false;
    taskBlink.disable();
    runner.enableAll();
    restartTrafficLight();
    Serial.println("STATE: BLINK_OFF");
  }
}

void disableOff() {
  // 현재 OFF면 isOn==false
  if (!isOn) {
    isOn = true;
    Serial.println("STATE: TRAFFIC_ON");
    runner.enableAll();
    restartTrafficLight();
  }
}

// -------------------- (B) 하드웨어 버튼 ISR --------------------
void ISR_Emergency() {
  if (millis() - lastButtonPress < 200) return;
  lastButtonPress = millis();

  // "긴급" 모드 요청
  handleModeChange("EMERGENCY");
}

void ISR_Blinking() {
  if (millis() - lastButtonPress < 200) return;
  lastButtonPress = millis();

  // "깜빡이" 모드 요청
  handleModeChange("BLINK");
}

void ISR_OnOff() {
  if (millis() - lastButtonPress < 200) return;
  lastButtonPress = millis();

  // "ONOFF" 모드 요청
  handleModeChange("ONOFF");
}

// -------------------- (C) p5.js가 보낸 MODE: ... 처리 --------------------
void handleModeChange(String mode) {
  Serial.print("🚦 모드 요청: ");
  Serial.println(mode);

  if (mode == "EMERGENCY") {
    // 1) 깜빡이 중이라면 해제
    disableBlink();
    // 2) OFF 중이라면 ON으로
    disableOff();
    // 3) 긴급 토글
    isEmergency = !isEmergency;

    if (isEmergency) {
      // ON
      Serial.println("STATE: EMERGENCY");
      runner.disableAll();
      taskBrightnessUpdate.enable();
      analogWrite(RED_LED, brightness);
      analogWrite(YELLOW_LED, 0);
      analogWrite(GREEN_LED,  0);
    } else {
      // OFF
      disableEmergency();
    }
  }
  else if (mode == "NORMAL") {
    // 기본 신호등 모드 (노멀)
    Serial.println("STATE: NORMAL");
    isEmergency = false;
    isBlinking  = false;
    isOn = true;
    runner.enableAll();
    restartTrafficLight();
  }
  else if (mode == "BLINK") {
    // 1) 긴급 해제
    disableEmergency();
    // 2) OFF 해제
    disableOff();
    // 3) 깜빡이 토글
    isBlinking = !isBlinking;

    if (isBlinking) {
      Serial.println("STATE: BLINK_ON");
      runner.disableAll();
      taskBrightnessUpdate.enable();
      taskBlink.enable();
    } else {
      disableBlink();
    }
  }
  else if (mode == "ONOFF") {
    // 1) 긴급 해제
    disableEmergency();
    // 2) 깜빡이 해제
    disableBlink();
    // 3) ON/OFF 토글
    isOn = !isOn;

    if (!isOn) {
      // OFF
      Serial.println("STATE: TRAFFIC_OFF");
      runner.disableAll();
      analogWrite(RED_LED,    0);
      analogWrite(YELLOW_LED, 0);
      analogWrite(GREEN_LED,  0);
    } else {
      // ON
      Serial.println("STATE: TRAFFIC_ON");
      runner.enableAll();
      restartTrafficLight();
    }
  }
}

// -------------------- (D) 시리얼 수신 --------------------
void checkSerialInput() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    Serial.print("📥 명령 수신: ");
    Serial.println(command);

    // "MODE: XXX" → handleModeChange()
    if (command.startsWith("MODE: ")) {
      String mode = command.substring(6);
      handleModeChange(mode);
    }
    else if (command.startsWith("TIME: ")) {
      // 기존 시간 변경 로직
      int spaceIndex = command.indexOf(' ', 6);
      if (spaceIndex != -1) {
        String color = command.substring(6, spaceIndex);
        float time = command.substring(spaceIndex + 1).toInt() * 1000;

        Serial.print("⏳ 신호 변경: ");
        Serial.print(color);
        Serial.print(" - ");
        Serial.print(time / 1000);
        Serial.println(" SECOND");

        if (color == "RED") {
          taskRed.setInterval(time);
          Serial.println("✅ taskRed 업데이트 완료");
        } else if (color == "YELLOW") {
          taskYellow.setInterval(time);
          taskYellowBlink.setInterval(time);
          Serial.println("✅ taskYellow 업데이트 완료");
        } else if (color == "GREEN") {
          taskGreen.setInterval(time);
          Serial.println("✅ taskGreen 업데이트 완료");
        }
      } else {
        Serial.println("❌ TIME 명령어 파싱 실패!");
      }
    }
  }
}

// -------------------- (E) loop() --------------------
void loop() {
  checkSerialInput();
  runner.execute();
}
