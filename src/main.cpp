#include <Arduino.h>
#include <PinChangeInterrupt.h>
#include <TaskScheduler.h>

#define RED_LED 9
#define YELLOW_LED 10
#define GREEN_LED 11

#define BTN_EMERGENCY 6
#define BTN_BLINK 7
#define BTN_ONOFF 8

#define POTENTIOMETER A0  

Scheduler runner;

// 모드 상태 플래그
volatile bool isEmergency = false;
volatile bool isBlinking  = false;
volatile bool isOn        = true;

volatile unsigned long lastButtonPress = 0;

// 밝기 변수
int brightness = 255;

// ------------------------ 함수 선언 ------------------------
void ISR_Emergency();
void ISR_Blinking();
void ISR_OnOff();

void LedRedOn();
void LedYellowOn();
void LedGreenOn();
void ToggleGreenBlink();
void LedYellowBlink();

// --------------------------------------
// TaskScheduler로 관리되는 태스크들
// --------------------------------------
Task taskRed(2000, TASK_FOREVER, &LedRedOn,      &runner, true);
Task taskYellow(500, TASK_FOREVER, &LedYellowOn, &runner, false);
Task taskGreen(2000, TASK_FOREVER, &LedGreenOn,  &runner, false);
Task taskGreenBlink(166, TASK_FOREVER, &ToggleGreenBlink, &runner, false);
Task taskYellowBlink(500, TASK_FOREVER, &LedYellowBlink,  &runner, false);

// 밝기 측정
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

// 전체 LED 깜빡임 모드 태스크
Task taskBlink(500, TASK_FOREVER, []() {
  static bool state = false;
  state = !state;
  analogWrite(RED_LED,    state ? brightness : 0);
  analogWrite(YELLOW_LED, state ? brightness : 0);
  analogWrite(GREEN_LED,  state ? brightness : 0);
}, &runner, false);


// ------------------------ setup() ------------------------
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

// ------------------------ 기본 신호등 로직 ------------------------
void LedRedOn() {
  if (!isOn || isEmergency || isBlinking) return;

  Serial.println("STATE: RED_ON");
  analogWrite(RED_LED, brightness);
  analogWrite(YELLOW_LED, 0);
  analogWrite(GREEN_LED, 0);

  taskRed.disable();
  taskYellow.enableDelayed(taskRed.getInterval());
}

void LedYellowOn() {
  if (!isOn || isEmergency || isBlinking) return;

  Serial.println("STATE: YELLOW_ON");
  analogWrite(RED_LED, 0);
  analogWrite(YELLOW_LED, brightness);
  analogWrite(GREEN_LED, 0);

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


// ------------------------ 신호등 재시작 ------------------------
void restartTrafficLight() {
  Serial.println("STATE: RESET");
  runner.disableAll();

  analogWrite(RED_LED,    0);
  analogWrite(YELLOW_LED, 0);
  analogWrite(GREEN_LED,  0);

  taskRed.enable();
  taskBrightnessUpdate.enable(); // 밝기는 계속 체크
}

// ------------------------ (1) 하드웨어 버튼: 여기서 직접 토글 & STATE 출력 ------------------------
void ISR_Emergency() {
  if (millis() - lastButtonPress < 200) return;
  lastButtonPress = millis();

  // 직접 토글
  isEmergency = !isEmergency;

  if (isEmergency) {
    // 긴급 ON
    Serial.println("STATE: EMERGENCY");
    runner.disableAll();
    taskBrightnessUpdate.enable();
    analogWrite(RED_LED, brightness);
    analogWrite(YELLOW_LED, 0);
    analogWrite(GREEN_LED,  0);
  } else {
    // 긴급 OFF
    runner.enableAll();
    restartTrafficLight();
  }
}

void ISR_Blinking() {
  if (millis() - lastButtonPress < 200) return;
  lastButtonPress = millis();

  // 직접 토글
  isBlinking = !isBlinking;

  if (isBlinking) {
    // 깜빡이 ON
    Serial.println("STATE: BLINK_ON");
    runner.disableAll();
    taskBrightnessUpdate.enable();
    taskBlink.enable();
  } else {
    // 깜빡이 OFF
    Serial.println("STATE: BLINK_OFF");
    taskBlink.disable();
    runner.enableAll();
    restartTrafficLight();
  }
}

void ISR_OnOff() {
  if (millis() - lastButtonPress < 200) return;
  lastButtonPress = millis();

  // 직접 토글
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


// ------------------------ (2) p5.js 쪽 "MODE: ..." 명령 처리: 여기서만 토글 ------------------------
void handleModeChange(String mode) {
  Serial.print("🚦 모드 변경 (p5): ");
  Serial.println(mode);

  if (mode == "EMERGENCY") {
    // p5에서 EMERGENCY 버튼 눌렀을 때 토글
    isEmergency = !isEmergency;
    if (isEmergency) {
      Serial.println("STATE: EMERGENCY");
      runner.disableAll();
      taskBrightnessUpdate.enable();
      analogWrite(RED_LED, brightness);
      analogWrite(YELLOW_LED, 0);
      analogWrite(GREEN_LED,  0);
    } else {
      runner.enableAll();
      restartTrafficLight();
    }
  }
  else if (mode == "BLINK") {
    // 깜빡이 토글
    isBlinking = !isBlinking;
    if (isBlinking) {
      Serial.println("STATE: BLINK_ON");
      runner.disableAll();
      taskBrightnessUpdate.enable();
      taskBlink.enable();
    } else {
      Serial.println("STATE: BLINK_OFF");
      taskBlink.disable();
      runner.enableAll();
      restartTrafficLight();
    }
  }
  else if (mode == "ONOFF") {
    // ON/OFF
    isOn = !isOn;
    if (!isOn) {
      Serial.println("STATE: TRAFFIC_OFF");
      runner.disableAll();
      analogWrite(RED_LED,    0);
      analogWrite(YELLOW_LED, 0);
      analogWrite(GREEN_LED,  0);
    } else {
      Serial.println("STATE: TRAFFIC_ON");
      runner.enableAll();
      restartTrafficLight();
    }
  }
}

// ------------------------ 시리얼 명령 수신 ------------------------
void checkSerialInput() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();

    // 디버깅 출력
    Serial.print("📥 명령 수신: ");
    Serial.println(command);

    // "MODE: XXX" → handleModeChange()
    if (command.startsWith("MODE: ")) {
      String mode = command.substring(6);
      handleModeChange(mode);
    }
    // "TIME: XXX" 처리
    else if (command.startsWith("TIME: ")) {
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

// ------------------------ loop() ------------------------
void loop() {
  checkSerialInput();
  runner.execute();
}
