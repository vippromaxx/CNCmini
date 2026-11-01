// Host harness: run the real moveBresenham body with GPIO/clock/MQTT stubs.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <utility>
#include <vector>

using std::min;
using std::max;
#define HIGH 1
#define LOW 0
#define constrain(value, lo, hi) ((value) < (lo) ? (lo) : ((value) > (hi) ? (hi) : (value)))
#include "motion_config.inc"

int32_t physicalX = 0, physicalY = 0;
uint16_t speedSteps = DEFAULT_SPEED;
uint32_t lastActivity = 0;
bool stopRequested = false;
int64_t emittedX = 0, emittedY = 0;
int pulsesX = 0, pulsesY = 0, mqttCalls = 0, stopAtCall = 0;
bool dirXHigh = false, dirYHigh = false;
std::vector<std::pair<int64_t, int64_t>> positions;

void digitalWrite(int pin, int value) {
  if (pin == PIN_X_DIR) dirXHigh = value == HIGH;
  if (pin == PIN_Y_DIR) dirYHigh = value == HIGH;
  if (pin == PIN_X_STEP && value == HIGH) {
    emittedX += (dirXHigh != INVERT_X_DIR) ? 1 : -1;
    ++pulsesX;
  }
  if (pin == PIN_Y_STEP && value == HIGH) {
    emittedY += (dirYHigh != INVERT_Y_DIR) ? 1 : -1;
    ++pulsesY;
  }
}
void enableMotors(bool) {}
void delayMicroseconds(uint32_t us) {
  if (us == 6) positions.emplace_back(emittedX, emittedY);
}
uint32_t millis() { return 0; }
void yield() {}
struct MqttStub {
  void loop() {
    if (++mqttCalls == stopAtCall) stopRequested = true;
  }
} mqtt;

#include "motion_under_test.inc"

void reset(int32_t x = 0, int32_t y = 0) {
  physicalX = x; physicalY = y;
  emittedX = x; emittedY = y;
  pulsesX = pulsesY = mqttCalls = stopAtCall = 0;
  stopRequested = false;
  positions.clear();
}

int main() {
  int failures = 0;
  reset();
  moveBresenham(-1, 2);
  bool ok = emittedX == -1 && emittedY == 2;
  std::cout << (ok ? "PASS" : "FAIL")
            << " minimal steep segment: expected=(-1,2), emitted=("
            << emittedX << ',' << emittedY << "), recorded=("
            << physicalX << ',' << physicalY << ")\n";
  failures += !ok;

  reset();
  for (int i = 0; i < 20; ++i) {
    moveBresenham(-1, 2);
    moveBresenham(0, 2);
    moveBresenham(0, 0);
  }
  ok = emittedX == 0 && emittedY == 0 && physicalX == 0 && physicalY == 0;
  std::cout << (ok ? "PASS" : "FAIL")
            << " 20 closed paths: expected=(0,0), emitted=("
            << emittedX << ',' << emittedY << "), recorded=("
            << physicalX << ',' << physicalY << ")\n";
  failures += !ok;

  int badSegments = 0, tested = 0;
  for (int dx = -48; dx <= 48; ++dx) {
    for (int dy = -48; dy <= 48; ++dy) {
      reset(103, -57);
      moveBresenham(103 + dx, -57 + dy);
      bool valid = emittedX == 103 + dx && emittedY == -57 + dy
          && physicalX == emittedX && physicalY == emittedY
          && pulsesX == abs(dx) && pulsesY == abs(dy);
      for (const auto &pt : positions) {
        // <= half a major-axis step of deviation from the requested line.
        const int64_t cross = (pt.first - 103) * dy - (pt.second + 57) * dx;
        if (2 * std::abs(cross) > max(abs(dx), abs(dy))) valid = false;
      }
      badSegments += !valid;
      ++tested;
    }
  }
  std::cout << (badSegments ? "FAIL" : "PASS") << " all octants/axes/zero: "
            << badSegments << '/' << tested << " incorrect segments\n";
  failures += badSegments != 0;

  // Curves exercise alternating major axes and direction changes.
  for (int orientation : {-1, 1}) {
    reset(80, 0);
    int badEndpoints = 0;
    for (int lap = 0; lap < 4; ++lap) {
      for (int i = 1; i <= 128; ++i) {
        const double angle = orientation * i * 2 * std::acos(-1.0) / 128;
        moveBresenham(std::lround(80 * std::cos(angle)), std::lround(80 * std::sin(angle)));
        if (emittedX != physicalX || emittedY != physicalY) ++badEndpoints;
      }
    }
    ok = emittedX == 80 && emittedY == 0 && badEndpoints == 0;
    std::cout << (ok ? "PASS" : "FAIL") << " circle endpoints/closure, direction="
              << orientation << ", badEndpoints=" << badEndpoints
              << ", emitted=(" << emittedX << ',' << emittedY << ")\n";
    failures += !ok;
  }

  reset();
  stopRequested = true;
  moveBresenham(20, 60);
  ok = pulsesX == 0 && pulsesY == 0 && physicalX == 0 && physicalY == 0;
  std::cout << (ok ? "PASS" : "FAIL") << " stop before move\n";
  failures += !ok;

  reset();
  stopAtCall = 2;
  moveBresenham(20, 100);
  ok = stopRequested && emittedX == physicalX && emittedY == physicalY
      && emittedY > 0 && emittedY < 100;
  std::cout << (ok ? "PASS" : "FAIL") << " stop mid-move keeps emitted position\n";
  failures += !ok;
  return failures ? 1 : 0;
}
