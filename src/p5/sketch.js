// 전역 변수
let serialPort = null;
let writer = null;
let serialBuffer = "";

let trafficStateElement, redIndicator, yellowIndicator, greenIndicator;
let blinkInterval = null;

// -----------------------------------
// p5.js setup()
// -----------------------------------
function setup() {
  noCanvas();

  // 버튼 가져오기
  let connectButton = select("#connectButton");
  let emergencyButton = select("#emergencyBtn");
  let blinkButton = select("#blinkBtn");
  let onOffButton = select("#onOffBtn");

  connectButton.mousePressed(connectSerial);

  // 버튼 누르면 “MODE: ~~” 로 아두이노에게 전송
  emergencyButton.mousePressed(() => sendCommand("MODE: EMERGENCY"));
  blinkButton.mousePressed(() => sendCommand("MODE: BLINK"));
  onOffButton.mousePressed(() => sendCommand("MODE: ONOFF"));

  // UI 요소
  trafficStateElement = select("#trafficState");
  redIndicator = select("#red-indicator");
  yellowIndicator = select("#yellow-indicator");
  greenIndicator = select("#green-indicator");

  // 슬라이더
  let redTimeSlider = document.getElementById("redTimeSlider");
  let yellowTimeSlider = document.getElementById("yellowTimeSlider");
  let greenTimeSlider = document.getElementById("greenTimeSlider");

  redTimeSlider.addEventListener("input", () => updateTrafficTime("RED", redTimeSlider.value));
  yellowTimeSlider.addEventListener("input", () => updateTrafficTime("YELLOW", yellowTimeSlider.value));
  greenTimeSlider.addEventListener("input", () => updateTrafficTime("GREEN", greenTimeSlider.value));
}

// -----------------------------------
// 시리얼 연결
// -----------------------------------
async function connectSerial() {
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });

    console.log("✅ 시리얼 포트 연결됨");
    writer = serialPort.writable.getWriter();

    readSerialData();
  } catch (error) {
    console.error("❌ 시리얼 연결 오류:", error);
  }
}

// -----------------------------------
// 시리얼 수신
// -----------------------------------
async function readSerialData() {
  if (!serialPort || !serialPort.readable) {
    console.error("❌ 시리얼 포트가 열려있지 않음. 데이터 수신 불가");
    return;
  }

  const decoder = new TextDecoderStream();
  const inputStream = serialPort.readable.pipeThrough(decoder);
  const reader = inputStream.getReader();

  while (true) {
    try {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        serialBuffer += value;
        while (serialBuffer.includes("\n")) {
          let index = serialBuffer.indexOf("\n");
          let line = serialBuffer.slice(0, index).trim();
          serialBuffer = serialBuffer.slice(index + 1);

          console.log("📥 수신 데이터:", line);
          updateUI(line);
        }
      }
    } catch (error) {
      console.error("❌ 시리얼 데이터 읽기 오류:", error);
      break;
    }
  }
}

// -----------------------------------
// 시리얼 전송
// -----------------------------------
async function sendCommand(command) {
  if (!serialPort || !serialPort.writable) {
    console.error("❌ 시리얼 포트가 연결되지 않음");
    return;
  }

  try {
    let commandStr = command + "\n";
    await writer.write(new TextEncoder().encode(commandStr));
    console.log("📤 명령 전송:", commandStr);
  } catch (error) {
    console.error("❌ 명령 전송 오류:", error);
  }
}

// -----------------------------------
// 슬라이더 TIME
// -----------------------------------
function updateTrafficTime(color, time) {
  document.getElementById(color.toLowerCase() + "TimeValue").innerText = time;
  sendCommand(`TIME: ${color} ${time}`);
}

// -----------------------------------
// UI 갱신 (STATE / MODE / BRIGHTNESS)
// -----------------------------------
function updateUI(data) {
  if (!data || typeof data !== "string") return;

  if (data.startsWith("STATE:")) {
    let state = data.split(": ")[1]?.trim() || "";
    trafficStateElement.html(state);

    // 기본 신호등 상태
    if (state === "RED_ON") {
      updateTrafficLight("red");
    } else if (state === "YELLOW_ON") {
      updateTrafficLight("yellow");
    } else if (state === "GREEN_ON") {
      updateTrafficLight("green");
    } 
    else if (state === "GREEN_BLINK") {
      blinkGreenLight(); 
    } 
    else if (state === "YELLOW_BLINK") {
      updateTrafficLight("yellow"); 
    }

    // 토글 상태
    else if (state === "BLINK_ON") {
      startBlinkingMode();
    } else if (state === "BLINK_OFF") {
      stopBlinkingMode();
      updateTrafficLight("red");
    } else if (state === "EMERGENCY") {
      stopBlinkingMode();
      updateTrafficLight("red");
    } else if (state === "RESET") {
      // 신호등 재시작
      stopBlinkingMode();
      updateTrafficLight("red");
    } else if (state === "TRAFFIC_OFF") {
      // 전부 끔
      stopBlinkingMode();
      updateTrafficLight("off");
    } else if (state === "TRAFFIC_ON") {
      // 다시 빨간불 등
      stopBlinkingMode();
      updateTrafficLight("red");
    }
  }
  else if (data.startsWith("MODE:")) {
    // 아두이노에서 "MODE: XXX" 자체를 보낼 수도 있으니 로그만 남김
    let mode = data.split(": ")[1]?.trim() || "";
    console.log("📥 모드 변경:", mode);
  }
  else if (data.startsWith("BRIGHTNESS:")) {
    let brightnessValue = parseInt(data.split(": ")[1]);
    if (!isNaN(brightnessValue)) {
      select("#brightnessValue").html(brightnessValue);
    }
  }
}

// -----------------------------------
// 신호등 색상 표시
// -----------------------------------
function updateTrafficLight(color) {
  redIndicator.style("background-color", "black");
  yellowIndicator.style("background-color", "black");
  greenIndicator.style("background-color", "black");

  if (color === "red") {
    redIndicator.style("background-color", "red");
  } else if (color === "yellow") {
    yellowIndicator.style("background-color", "yellow");
  } else if (color === "green") {
    greenIndicator.style("background-color", "green");
  } 
  else if (color === "off") {
    // 전부 꺼진 상태
  }
}

// -----------------------------------
// 전체 깜빡임 모드 (p5.js에서 setInterval)
// -----------------------------------
function startBlinkingMode() {
  stopBlinkingMode(); // 혹시 실행 중이었다면 중단
  let blinkState = false;
  blinkInterval = setInterval(() => {
    blinkState = !blinkState;
    redIndicator.style("background-color", blinkState ? "red" : "black");
    yellowIndicator.style("background-color", blinkState ? "yellow" : "black");
    greenIndicator.style("background-color", blinkState ? "green" : "black");
  }, 500);
}

function stopBlinkingMode() {
  if (blinkInterval) {
    clearInterval(blinkInterval);
    blinkInterval = null;
  }
  // 일단 전부 꺼짐
  redIndicator.style("background-color", "black");
  yellowIndicator.style("background-color", "black");
  greenIndicator.style("background-color", "black");
}

// -----------------------------------
// 초록불 깜빡이 전용
// -----------------------------------
function blinkGreenLight() {
    const blackSet = ["black", "rgb(0, 0, 0)", ""];
    const currentColor = greenIndicator.style("background-color");
    const newColor = blackSet.includes(currentColor) ? "green" : "black";
    greenIndicator.style("background-color", newColor);
  }
  