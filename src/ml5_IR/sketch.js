// === 전역 변수 선언 ===
let video;
let handpose;
let predictions = [];

// 손 검지 끝 경로 추적 (제스처 인식용)
let path = [];
const MAX_PATH_LENGTH = 50; // 최근 50프레임만 저장

// 제스처 및 버튼 효과 (heart, lightning, snow, victory)
let currentEffect = null;
let effectTimer = 0;

// 동그라미 제스처(눈 효과) 카운트
let circleCount = 0;

// 그림 그리기 관련 변수
let drawingLayer;
let mode = 'none'; // 'draw'일 때 그리기 모드 ON, 기본은 OFF
let indexPos = null;    // 최신 검지 좌표
let prevIndexPos = null;  // 이전 검지 좌표 (선 연결용)
let lastButtonPressed = null; // 버튼 중복 선택 방지

// 버튼 위치 및 크기 (상단: 하트, 번개 / 하단: 그리기 토글, 지우개)
const buttonWidth = 100;
const buttonHeight = 50;
const padding = 10; // 캔버스 가장자리와의 간격

function setup() {
  createCanvas(640, 480);
  
  // 그림 그리기용 레이어 생성
  drawingLayer = createGraphics(width, height);
  drawingLayer.clear();
  
  // 웹캠 준비
  video = createCapture(VIDEO);
  video.size(width, height);
  video.hide();

  // ml5 Handpose 모델 로드
  handpose = ml5.handpose(video, onModelReady);
  handpose.on('predict', results => {
    predictions = results;
  });
}

function onModelReady() {
  console.log("Handpose 모델 로드 완료!");
}

function draw() {
  // 웹캠 영상과 그리기 레이어 출력
  image(video, 0, 0, width, height);
  image(drawingLayer, 0, 0);
  
  // 검지 손가락 추적 및 제스처 경로 업데이트
  trackIndexFinger();
  
  // 제스처 효과 (현재 효과가 없을 때)
  if (!currentEffect) {
    let gesture = detectGesture(path);
    if (gesture) {
      currentEffect = gesture;
      effectTimer = 60;  // 1초 동안 유지
      console.log("인식된 제스처:", gesture);
    }
  }
  if (effectTimer > 0 && currentEffect) {
    drawEffect(currentEffect);
    effectTimer--;
    if (effectTimer <= 0) {
      currentEffect = null;
    }
  }
  
  // 상단 버튼 그리기 (하트, 번개)
  drawTopButtons();
  // 하단 버튼 그리기 (그리기 토글, 지우개)
  drawBottomButtons();
  
  // 버튼 선택 처리 (상단 + 하단)
  handleButtonSelection();
  
  // 그리기 모드가 ON일 때, 버튼 영역이 아닐 경우 drawingLayer에 선 그리기
  if (mode === 'draw' && indexPos && !isFingerOnAnyButton(indexPos)) {
    if (prevIndexPos) {
      drawingLayer.stroke(0); // 선 색: 검정
      drawingLayer.strokeWeight(4);
      drawingLayer.line(prevIndexPos.x, prevIndexPos.y, indexPos.x, indexPos.y);
    }
    prevIndexPos = { x: indexPos.x, y: indexPos.y };
  } else {
    prevIndexPos = null;
  }
}

// ------------------------------------------------
// 1) 검지 손가락 끝 좌표 누적 (제스처 및 그리기용)
function trackIndexFinger() {
  if (predictions.length > 0) {
    let hand = predictions[0];
    // hand.annotations.indexFinger[3] = 검지 끝 좌표
    let indexTip = hand.annotations.indexFinger[3];
    let x = indexTip[0];
    let y = indexTip[1];
    indexPos = { x, y };
    
    // 제스처 경로 업데이트
    path.push({ x, y });
    if (path.length > MAX_PATH_LENGTH) {
      path.shift();
    }
  }
}

// ------------------------------------------------
// 2) 제스처 인식 (동그라미 3회 -> snow, V자 -> victory)
function detectGesture(path) {
  if (path.length < 10) return null;
  
  // ----- 동그라미 제스처 체크 (눈 효과) -----
  let start = path[0];
  let end = path[path.length - 1];
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  let endDist = Math.sqrt(dx * dx + dy * dy);
  
  if (endDist < 30) { // 시작과 끝이 가까우면 "닫힌" 경로
    // 경로의 바운딩 박스 계산
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let pt of path) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
    let boxWidth = maxX - minX;
    let boxHeight = maxY - minY;
    // 폭과 높이의 차이가 작고 일정 크기 이상이면 원으로 판단
    if (Math.abs(boxWidth - boxHeight) < 20 && boxWidth > 30) {
      circleCount++;
      console.log("원 인식됨. 카운트:", circleCount);
      path.splice(0, path.length);
      if (circleCount >= 3) {
        circleCount = 0;
        return 'snow';  // 동그라미 3번이면 눈 효과 실행
      }
    }
  }
  
  // ----- V자 제스처 체크 (Victory 효과) -----
  if (path.length >= 3) {
    let first = path[0];
    let mid = path[Math.floor(path.length / 2)];
    let last = path[path.length - 1];
    if (mid.y > first.y + 20 && mid.y > last.y + 20) {
      if (first.x < mid.x && last.x > mid.x) {
        console.log("V자 제스처 인식됨.");
        path.splice(0, path.length);
        circleCount = 0;
        return 'victory';  // V자 제스처이면 Victory 효과 실행
      }
    }
  }
  return null;
}

// ------------------------------------------------
// 3) 효과 출력 (전체 캔버스에 나타남)
function drawEffect(effect) {
  switch (effect) {
    case 'heart':
      drawHearts();
      break;
    case 'lightning':
      drawLightning();
      break;
    case 'snow':
      drawSnow();
      break;
    case 'victory':
      drawVictory();
      break;
  }
}

function drawHearts() {
  for (let i = 0; i < 30; i++) {
    let x = random(width);
    let y = random(height);
    push();
    fill(255, 0, 0);
    textSize(32);
    text("❤", x, y);
    pop();
  }
}

function drawLightning() {
  push();
  strokeWeight(4);
  stroke(255, 255, 0);
  for (let i = 0; i < 10; i++) {
    let x1 = random(width);
    let y1 = random(height);
    let x2 = x1 + random(-20, 20);
    let y2 = y1 + random(20, 60);
    line(x1, y1, x2, y2);
  }
  pop();
}

function drawSnow() {
  noStroke();
  fill(255);
  for (let i = 0; i < 50; i++) {
    ellipse(random(width), random(height), 5, 5);
  }
}

function drawVictory() {
  push();
  textAlign(CENTER, CENTER);
  textSize(60);
  fill(0, 255, 0);
  text("Victory!", width / 2, height / 2);
  pop();
}

// ------------------------------------------------
// 4) 상단 버튼 그리기 (하트, 번개)
function drawTopButtons() {
  // 하트 버튼 (왼쪽 상단)
  fill(200);
  rect(padding, padding, buttonWidth, buttonHeight, 10);
  fill(0);
  textAlign(CENTER, CENTER);
  textSize(16);
  text("하트", padding + buttonWidth / 2, padding + buttonHeight / 2);
  
  // 번개 버튼 (오른쪽 상단)
  fill(200);
  rect(width - buttonWidth - padding, padding, buttonWidth, buttonHeight, 10);
  fill(0);
  textAlign(CENTER, CENTER);
  textSize(16);
  text("번개", width - buttonWidth / 2 - padding, padding + buttonHeight / 2);
}

// ------------------------------------------------
// 5) 하단 버튼 그리기 (그리기 토글, 지우개)
function drawBottomButtons() {
  // 그리기 토글 버튼 (왼쪽 하단)
  fill(200);
  rect(padding, height - buttonHeight - padding, buttonWidth, buttonHeight, 10);
  fill(0);
  textAlign(CENTER, CENTER);
  textSize(16);
  let drawText = (mode === 'draw') ? "그리기 ON" : "그리기 OFF";
  text(drawText, padding + buttonWidth / 2, height - buttonHeight / 2 - padding);
  
  // 지우개 버튼 (오른쪽 하단)
  fill(200);
  rect(width - buttonWidth - padding, height - buttonHeight - padding, buttonWidth, buttonHeight, 10);
  fill(0);
  textAlign(CENTER, CENTER);
  textSize(16);
  text("지우개", width - buttonWidth / 2 - padding, height - buttonHeight / 2 - padding);
}

// ------------------------------------------------
// 6) 버튼 영역 여부 체크 (상단+하단)
function isFingerOnAnyButton(pos) {
  // 상단 버튼 영역
  let onTopLeft = (pos.x >= padding && pos.x <= padding + buttonWidth && pos.y >= padding && pos.y <= padding + buttonHeight);
  let onTopRight = (pos.x >= width - buttonWidth - padding && pos.x <= width - padding && pos.y >= padding && pos.y <= padding + buttonHeight);
  // 하단 버튼 영역
  let onBottomLeft = (pos.x >= padding && pos.x <= padding + buttonWidth && pos.y >= height - buttonHeight - padding && pos.y <= height - padding);
  let onBottomRight = (pos.x >= width - buttonWidth - padding && pos.x <= width - padding && pos.y >= height - buttonHeight - padding && pos.y <= height - padding);
  return onTopLeft || onTopRight || onBottomLeft || onBottomRight;
}

// ------------------------------------------------
// 7) 버튼 선택 처리 (상단 및 하단)
function handleButtonSelection() {
  if (indexPos) {
    // 상단 버튼: 하트 버튼 (왼쪽 상단)
    if (indexPos.x >= padding && indexPos.x <= padding + buttonWidth &&
        indexPos.y >= padding && indexPos.y <= padding + buttonHeight) {
      if (lastButtonPressed !== 'heart') {
        currentEffect = 'heart';
        effectTimer = 60;
        lastButtonPressed = 'heart';
        console.log("하트 버튼 선택됨");
      }
    }
    // 상단 버튼: 번개 버튼 (오른쪽 상단)
    else if (indexPos.x >= width - buttonWidth - padding && indexPos.x <= width - padding &&
             indexPos.y >= padding && indexPos.y <= padding + buttonHeight) {
      if (lastButtonPressed !== 'lightning') {
        currentEffect = 'lightning';
        effectTimer = 60;
        lastButtonPressed = 'lightning';
        console.log("번개 버튼 선택됨");
      }
    }
    // 하단 버튼: 그리기 토글 버튼 (왼쪽 하단)
    else if (indexPos.x >= padding && indexPos.x <= padding + buttonWidth &&
             indexPos.y >= height - buttonHeight - padding && indexPos.y <= height - padding) {
      if (lastButtonPressed !== 'drawToggle') {
        mode = (mode === 'draw') ? 'none' : 'draw';
        lastButtonPressed = 'drawToggle';
        console.log("그리기 모드 토글됨, 현재 모드:", mode);
      }
    }
    // 하단 버튼: 지우개 버튼 (오른쪽 하단)
    else if (indexPos.x >= width - buttonWidth - padding && indexPos.x <= width - padding &&
             indexPos.y >= height - buttonHeight - padding && indexPos.y <= height - padding) {
      if (lastButtonPressed !== 'erase') {
        drawingLayer.clear();
        lastButtonPressed = 'erase';
        console.log("지우개 버튼 선택됨, 그림 지움");
      }
    } else {
      lastButtonPressed = null;
    }
  }
}
