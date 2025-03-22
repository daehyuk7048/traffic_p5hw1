let serial;
let latestData = "";
let trafficState = "대기 중...";
let serialBuffer = ""; // 📡 데이터 버퍼
let greenIndicatorBlink = false; // 🟢 초록불 깜빡임 상태
// UI 요소 캐싱
let trafficStateElement, redIndicator, yellowIndicator, greenIndicator;
//handpose
let handpose;
let video;
let hands = [];
let gestureThreshold = 50; // 손가락 거리 임계값 예시

// --- 전역 변수: 게이지 제스처 관련 ---
let selectedSlider = null;     // "RED", "YELLOW", "GREEN"
let sliderSelectedTime = 0;      // millis() 기준 선택된 시점
let adjustingSlider = false;     // 게이지 조정 모드 여부
let lastAdjustmentTime = 0;      // 마지막 조정 시각

async function setup() {
    noCanvas();

      // (1) p5.js 캔버스 생성
    let c = createCanvas(640, 480);
    c.parent("canvasContainer");

    // (2) 비디오 캡처
    video = createCapture(VIDEO);
    video.size(640, 480);
    video.hide();

    // (3) HandPose 모델 로드
    handposeModel = ml5.handpose(video, modelLoaded);

    function modelLoaded() {
        console.log("✅ Handpose model ready");
    }
    // 손 인식 결과가 들어올 때마다 hands 배열 갱신
    handposeModel.on("predict", (results) => {
        hands = results;
    });

    // ✅ UI 요소 가져오기
    noSmooth(); //optional
    let connectButton = select("#connectButton");
    let emergencyButton = select("#emergencyBtn");
    let blinkButton = select("#blinkBtn");
    let onOffButton = select("#onOffBtn");

    connectButton.mousePressed(connectSerial);
    emergencyButton.mousePressed(() => sendCommand("MODE: EMERGENCY"));
    blinkButton.mousePressed(() => sendCommand("MODE: BLINK"));
    onOffButton.mousePressed(() => sendCommand("MODE: ONOFF"));

    trafficStateElement = select("#trafficState");
    redIndicator = select("#red-indicator");
    yellowIndicator = select("#yellow-indicator");
    greenIndicator = select("#green-indicator");

    // 슬라이더 요소 가져오기
    let redTimeSlider = document.getElementById("redTimeSlider");
    let yellowTimeSlider = document.getElementById("yellowTimeSlider");
    let greenTimeSlider = document.getElementById("greenTimeSlider");

    // 슬라이더 값 변경 시 UI 업데이트 및 아두이노 전송
    redTimeSlider.addEventListener("input", () => updateTrafficTime("RED", redTimeSlider.value));
    yellowTimeSlider.addEventListener("input", () => updateTrafficTime("YELLOW", yellowTimeSlider.value));
    greenTimeSlider.addEventListener("input", () => updateTrafficTime("GREEN", greenTimeSlider.value));

}

let serialPort = null; // ✅ 시리얼 포트를 저장하는 변수 추가
let writer = null; // ✅ 시리얼 데이터 전송을 위한 writer 객체
let blinkInterval = null; // 🔥 깜빡임 모드 setInterval() ID 저장 변수
// ---------------------- p5.js draw ----------------------
function draw() {
    background(220);
    image(video, 0, 0, width, height);
    
    // 디버깅용: 손 관절점 그리기
    for (let i = 0; i < hands.length; i++) {
      let hand = hands[i];
      for (let j = 0; j < hand.landmarks.length; j++) {
        let [x, y, z] = hand.landmarks[j];
        fill(0, 255, 0);
        noStroke();
        circle(x, y, 10);
      }
    }
    
    if (hands.length > 0) {
      let hand = hands[0];
      
      // --- (A) 게이지 선택: "OK" 제스처로 선택
      if (!selectedSlider && !adjustingSlider) {
        if (isOkGesture(hand)) {
          let wristX = hand.landmarks[0][0];
          if (wristX < width / 3) {
            selectedSlider = "RED";
            console.log("게이지 선택: RED (OK 제스처)");
          } else if (wristX < (2 * width) / 3) {
            selectedSlider = "YELLOW";
            console.log("게이지 선택: YELLOW (OK 제스처)");
          } else {
            selectedSlider = "GREEN";
            console.log("게이지 선택: GREEN (OK 제스처)");
          }
          sliderSelectedTime = millis();
        }
      }
      
      // (B) 선택 후 1초 후 게이지 조정 모드 활성화
      if (selectedSlider && !adjustingSlider) {
        if (millis() - sliderSelectedTime > 1000) {
          adjustingSlider = true;
          lastAdjustmentTime = millis();
          console.log("게이지 조정 모드 시작:", selectedSlider);
        }
      }
      
      // (C) 게이지 조정 모드: 
      // 모든 손가락이 펴진 상태 → 게이지 증가
      // 주먹(모든 손가락 접힘) → 게이지 감소
      if (adjustingSlider) {
        let now = millis();
        if (now - lastAdjustmentTime > 500) {  // 0.5초마다 조정
          if (isAllFingersExtended(hand)) {
            incrementSlider(selectedSlider, +0.1);
            console.log("모든 손가락 펴짐 → 게이지 증가");
            lastAdjustmentTime = now;
          } else if (isFist(hand)) {
            incrementSlider(selectedSlider, -0.1);
            console.log("주먹 → 게이지 감소");
            lastAdjustmentTime = now;
          }
        }
        
        // (D) 조정 모드 종료: 3초 동안 손 상태 변화(게이지 증가/감소 제스처)가 없으면 종료
        if (now - lastAdjustmentTime > 3000) {
          console.log("게이지 조정 모드 종료 (3초 inactivity)");
          selectedSlider = null;
          adjustingSlider = false;
        }
      }
      
      // (E) 게이지 제스처가 활성화 중이 아니면, 기존 모드 제스처 처리
      if (!selectedSlider && !adjustingSlider) {
        let extCount = countExtendedFingers(hand);
        if (extCount === 1 && isThumbExtended(hand)) {
          if (frameCount % 60 === 0) {
            console.log("제스처 => 긴급 모드");
            sendCommand("MODE: EMERGENCY");
          }
        } else if (extCount === 2 && isThumbIndexExtended(hand)) {
          if (frameCount % 60 === 0) {
            console.log("제스처 => 깜빡이 모드");
            sendCommand("MODE: BLINK");
          }
        } else if (extCount === 3 && isThumbIndexMiddleExtended(hand)) {
          if (frameCount % 60 === 0) {
            console.log("제스처 => ON/OFF 모드");
            sendCommand("MODE: ONOFF");
          }
        } else if (extCount === 4 && isThumbIndexMiddleRingExtended(hand)) {
          if (frameCount % 60 === 0) {
            console.log("제스처 => 기본 신호등 (NORMAL)");
            sendCommand("MODE: NORMAL");
          }
        }
      }
    }
  }
  
  // --- incrementSlider 함수 ---
function incrementSlider(color, delta) {
    let sliderElem;
    if (color === "RED") {
      sliderElem = document.getElementById("redTimeSlider");
    } else if (color === "YELLOW") {
      sliderElem = document.getElementById("yellowTimeSlider");
    } else if (color === "GREEN") {
      sliderElem = document.getElementById("greenTimeSlider");
    }
    if (!sliderElem) return;
    
    let curVal = parseFloat(sliderElem.value);
    let newVal = curVal + delta;
    newVal = Math.max(newVal, parseFloat(sliderElem.min));
    newVal = Math.min(newVal, parseFloat(sliderElem.max));
    sliderElem.value = newVal.toFixed(1);
    document.getElementById(color.toLowerCase() + "TimeValue").innerText = newVal.toFixed(1);
    sendCommand(`TIME: ${color} ${newVal.toFixed(1)}`);
    console.log(`슬라이더 ${color} = ${newVal.toFixed(1)}`);
  }
  // ---------------------- 간단한 손가락 확장 판별 함수 ----------------------
  // --- 헬퍼 함수들 ---
  // 두 점 사이의 유클리드 거리 계산 (p5.js 내장 함수 dist() 사용 가능)
function distance(pt1, pt2) {
    return dist(pt1[0], pt1[1], pt2[0], pt2[1]);
  }

function isFingerExtended(hand, tipIdx, pipIdx, tolerance = 10) {
    let tip = hand.landmarks[tipIdx];
    let pip = hand.landmarks[pipIdx];
    if (!tip || !pip) return false;
    // pip[1] - tip[1]가 tolerance 이상이면 펴진 것으로 간주
    return (pip[1] - tip[1] > tolerance);
  }
  
function countExtendedFingers(hand) {
    // Mediapipe Handpose의 관절 인덱스
    // Thumb tip=4, Index tip=8, Middle=12, Ring=16, Pinky=20
    // 단순히 tip.y < 해당 손가락 중간 joint.y 이면 '펴졌다'고 가정(매우 나이브)
    if (!hand.landmarks || hand.landmarks.length < 5) {
        console.log("No enough keypoints");
        return 0;
      }
    
    let tipIndices = [4, 8, 12, 16, 20];
    let extended = 0;
    
    for (let idx of tipIndices) {
      let tip = hand.landmarks[idx];
      let pip = hand.landmarks[idx - 2]; // tip 바로 아래 joint
      if (!tip || !pip) continue;
      if (tip[1] < pip[1]) {
        // 펴진 것으로 간주(세로 좌표가 더 위이면)
        extended++;
      }
    }
    console.log("extendedCount =", extended);
    return extended;
  }

  function isAllFingersExtended(hand) {
    return countExtendedFingers(hand) === 5;
  }
  
  function isFist(hand) {
    return countExtendedFingers(hand) <= 1;
  }
  // OK 제스처: 엄지와 검지가 서로 가까워지고, 나머지 (중지, 약지, 새끼)는 확장됨
function isOkGesture(hand, distanceThreshold = 30, tol = 10) {
    let thumbTip = hand.landmarks[4];
    let indexTip = hand.landmarks[8];
    if (!thumbTip || !indexTip) return false;
    
    // 엄지와 검지 사이 거리가 threshold 이하인지 확인
    if (distance(thumbTip, indexTip) > distanceThreshold) return false;
    
    // 중지, 약지, 새끼가 확장되었는지 확인
    let middle = isFingerExtended(hand, 12, 10, tol);
    let ring   = isFingerExtended(hand, 16, 14, tol);
    let pinky  = isFingerExtended(hand, 20, 18, tol);
    
    return middle && ring && pinky;
  }
  
  //주먹을 쥐면 게이지 내려감
  function isIndexDown(hand) {
    let wrist = hand.landmarks[0];
    let indexTip = hand.landmarks[8];
    if (!wrist || !indexTip) return false;
    return (indexTip[1] > wrist[1]);
  }
  // “엄지 하나만” 펴진 상황인지 체크(extendedCount===1 이어야)
function isThumbExtended(hand) {
    // thumb tip=4, pip=2
    let tip = hand.landmarks[4];
    let pip = hand.landmarks[2];
    if(!tip || !pip) return false;
    // tip.y < pip.y => 펴진 엄지
    return (tip[1] < pip[1]);
  }
  
  // “엄지+검지”인지 체크(extendedCount===2)
  function isThumbIndexExtended(hand) {
    // thumb tip=4, pip=2 / index tip=8, pip=6
    let ttip = hand.landmarks[4];
    let tpip = hand.landmarks[2];
    let itip = hand.landmarks[8];
    let ipip = hand.landmarks[6];
    if(!ttip || !tpip || !itip || !ipip) return false;
    return (ttip[1] < tpip[1] && itip[1] < ipip[1]);
  }
  
  // “엄지+검지+중지”인지 체크(extendedCount===3)
  function isThumbIndexMiddleExtended(hand) {
    // 중지 tip=12, pip=10
    let mtip = hand.landmarks[12];
    let mpip = hand.landmarks[10];
    if(!mtip || !mpip) return false;
  
    return isThumbIndexExtended(hand) && (mtip[1] < mpip[1]);
  }

  // “엄지+검지+중지+약지”가 모두 펴졌는지 판별(extendedCount===4)
function isThumbIndexMiddleRingExtended(hand) {
    // 엄지 tip=4, pip=2 / 검지 tip=8, pip=6 / 중지 tip=12, pip=10 / 약지 tip=16, pip=14
    let ttip = hand.landmarks[4], tpip = hand.landmarks[2];
    let itip = hand.landmarks[8], ipip = hand.landmarks[6];
    let mtip = hand.landmarks[12], mpip = hand.landmarks[10];
    let rtip = hand.landmarks[16], rpip = hand.landmarks[14];
    if (!ttip || !tpip || !itip || !ipip || !mtip || !mpip || !rtip || !rpip) return false;
    return (ttip[1] < tpip[1] &&
            itip[1] < ipip[1] &&
            mtip[1] < mpip[1] &&
            rtip[1] < rpip[1]);
  }

async function connectSerial() {
    try {
        serialPort = await navigator.serial.requestPort();
        await serialPort.open({ baudRate: 115200 });

        console.log("✅ 시리얼 포트 연결됨");

        if (!serialPort.readable) { // ✅ readable 속성이 존재하는지 확인
            console.error("❌ 시리얼 포트가 올바르게 열리지 않음");
            return;
        }

        writer = serialPort.writable.getWriter(); // ✅ writer 저장
        readSerialData();
    } catch (error) {
        console.error("❌ 시리얼 연결 오류:", error);
    }
}
// 📡 시리얼 데이터 수신 (버퍼 처리)
async function readSerialData() {
    if (!serialPort || !serialPort.readable) { // ✅ 포트가 존재하는지 확인
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

// 📡 아두이노로 명령 전송 함수
async function sendCommand(command) {
    if (!serialPort || !serialPort.writable) {
        console.error("❌ 시리얼 포트가 연결되지 않음");
        return;
    }

    try {
        if (!writer) {
            writer = serialPort.writable.getWriter();
        }

        let commandStr = command + "\n";
        await writer.write(new TextEncoder().encode(commandStr));
        console.log("📤 명령 전송:", commandStr);
        writer.releaseLock();
        writer = null;

        // 🔥 버튼 클릭 시 즉시 UI 반영
        let mode = command.split(": ")[1]?.trim();
        updateTrafficLightForMode(mode); // ✅ 버튼 누르면 바로 반영

    } catch (error) {
        console.error("❌ 명령 전송 오류:", error);
    }
}

function updateTrafficTime(color, time) {
    // 화면 업데이트
    document.getElementById(color.toLowerCase() + "TimeValue").innerText = time;

    // 아두이노로 데이터 전송
    sendCommand(`TIME: ${color} ${time}`);
}

// 🚦 UI 갱신 함수
function updateUI(data) {
    if (!data || typeof data !== "string") return;

    if (data.startsWith("STATE:")) {
        let state = data.split(": ")[1]?.trim() || "";  
        trafficState = state;
        trafficStateElement.html(state);

        if (state === "RED_ON") {
            updateTrafficLight("red");
        } else if (state === "YELLOW_ON") {
            updateTrafficLight("yellow");
        } else if (state === "GREEN_ON") {
            updateTrafficLight("green"); // ✅ 초록불 2초 유지
            greenIndicatorBlink = false;
        } else if (state === "GREEN_BLINK") {
            blinkGreenLight(); // ✅ 초록불 깜빡임
        }
         // ✅ "MODE: " 수신 → UI 버튼 반영
        else if (data.startsWith("MODE:")) {
        let mode = data.split(": ")[1]?.trim() || "";
        console.log("📥 모드 변경:", mode);
        updateTrafficLightForMode(mode); // 🔥 모드 변경 후 신호등 즉시 반영
    }
    }
    // ✅ **가변저항 밝기 업데이트 추가**
    if (data.startsWith("BRIGHTNESS:")) {
        let brightnessValue = parseInt(data.split(": ")[1]);
        if (!isNaN(brightnessValue)) {
            select("#brightnessValue").html(brightnessValue); // ✅ UI 업데이트
        }
    }
}
// 🚦 신호등 UI 업데이트
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
    } else if (color === "off") {
        // 모든 신호등을 끄는 모드
        redIndicator.style("background-color", "black");
        yellowIndicator.style("background-color", "black");
        greenIndicator.style("background-color", "black");
    }
}


function updateTrafficLightForMode(mode) {
    if (mode === "EMERGENCY") {
        stopBlinkingMode(); // 🔥 기존 깜빡임 모드 종료
        updateTrafficLight("red"); // 🔴 긴급 모드는 빨간불 ON
    } else if (mode === "BLINK") {
        toggleBlinkingMode(); // 🔥 깜빡임 모드 실행/정지
    } else if (mode === "ONOFF") {
        stopBlinkingMode(); // 🔥 깜빡임 정지 후 기존 신호 복구
        updateTrafficLight("off"); // 기본값: 빨간불 ON
    } else if (mode === "NORMAL") {
      stopBlinkingMode();       // 깜빡임 중이라면 정지
      updateTrafficLight("red"); // 원하는 기본 색상 (빨간불 등)
    }
}

// 깜빡임 모드 실행 함수 추가
function startBlinkingMode() {
    // 🔥 기존 깜빡임이 실행 중이라면 중지
    if (blinkInterval) {
        clearInterval(blinkInterval);
        blinkInterval = null;
    }

    // 🔥 기존 신호등 OFF
    updateTrafficLight("off");

    let blinkState = false;
    blinkInterval = setInterval(() => {
        blinkState = !blinkState;
        redIndicator.style("background-color", blinkState ? "red" : "black");
        yellowIndicator.style("background-color", blinkState ? "yellow" : "black");
        greenIndicator.style("background-color", blinkState ? "green" : "black");
    }, 500);
}
// ✅ 깜빡이 모드 ON/OFF 토글 방식으로 변경
function toggleBlinkingMode() {
    if (blinkInterval) {
        stopBlinkingMode(); // 🔥 깜빡임이 실행 중이면 정지
    } else {
        startBlinkingMode(); // 🔥 아니라면 시작
    }
}

function startBlinkingMode() {
    if (blinkInterval) {
        clearInterval(blinkInterval);
        blinkInterval = null;
    }

    updateTrafficLight("off");

    let blinkState = false;
    blinkInterval = setInterval(() => {
        blinkState = !blinkState;
        redIndicator.style("background-color", blinkState ? "red" : "black");
        yellowIndicator.style("background-color", blinkState ? "yellow" : "black");
        greenIndicator.style("background-color", blinkState ? "green" : "black");
    }, 500);
}
// 🔥 깜빡임 모드를 종료하는 함수
function stopBlinkingMode() {
    if (blinkInterval) {
        clearInterval(blinkInterval);
        blinkInterval = null;
    }

    updateTrafficLight("red");
}


// 🟢 **초록불 깜빡임 반영**
function blinkGreenLight() {
    greenIndicatorBlink = !greenIndicatorBlink;
    greenIndicator.style("background-color", greenIndicatorBlink ? "green" : "black");  
}
