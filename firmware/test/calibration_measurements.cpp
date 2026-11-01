// Test the actual calibration function against independently measured travel.
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <limits>
#include <map>
#include <string>
#include <tuple>

using std::isfinite;
#define constrain(value, lo, hi) std::clamp((value), (lo), (hi))
#include "calibration_config.inc"
int32_t physicalX = 0, physicalY = 0, posX = 0, posY = 0;
int32_t xMin = 0, xMax = DEFAULT_X_LIMIT, yMin = 0, yMax = DEFAULT_Y_LIMIT;
float axisScaleX = 1, axisScaleY = 1;
bool calibrated = false, measuredCalibration = false;
std::string calibrationError;
int saves = 0;
struct PreferencesStub {
  std::map<std::string, double> values;
  double get(const char *key, double fallback) { auto it = values.find(key); return it == values.end() ? fallback : it->second; }
  bool getBool(const char *key, bool fallback) { return get(key, fallback); }
  uint8_t getUChar(const char *key, uint8_t fallback) { return get(key, fallback); }
  int32_t getLong(const char *key, int32_t fallback) { return get(key, fallback); }
  float getFloat(const char *key, float fallback) { return get(key, fallback); }
  void putBool(const char *key, bool value) { values[key] = value; ++saves; }
  void putUChar(const char *key, uint8_t value) { values[key] = value; ++saves; }
  void putLong(const char *key, int32_t value) { values[key] = value; ++saves; }
  void putFloat(const char *key, float value) { values[key] = value; ++saves; }
} prefs;
#include "calibration_under_test.inc"

bool calibrate(float x, float y) {
#if CALIBRATION_ACCEPTS_MEASUREMENTS
  return setCalibrationLimit(x, y);
#else
  setCalibrationLimit();
  return true;
#endif
}

auto snapshot() {
  return std::make_tuple(physicalX, physicalY, posX, posY, xMin, xMax,
                        yMin, yMax, axisScaleX, axisScaleY,
                        calibrated, measuredCalibration, saves);
}

int main() {
  int failures = 0;
  auto check = [&](bool ok, const char *name) {
    std::cout << (ok ? "PASS " : "FAIL ") << name << '\n';
    failures += !ok;
  };
  physicalX = 250; physicalY = 850;
  check(calibrate(40, 50) && std::abs(axisScaleX - 6.25f) < 0.0001f &&
        std::abs(axisScaleY - 17.0f) < 0.0001f && xMax == 40 && yMax == 50 &&
        calibrated && measuredCalibration, "250/850 pulses measured as 40/50 mm");

  // The simulated mechanics are independent of the firmware scale values.
  const float actualStepsPerMmX = 250.0f / 40.0f;
  const float actualStepsPerMmY = 850.0f / 50.0f;
  float worstError = 0;
  for (int i = 0; i <= 64; ++i) {
    const float angle = i * 6.28318530718f / 64;
    const int x = std::lround(20 + 16 * std::cos(angle));
    const int y = std::lround(25 + 16 * std::sin(angle));
    const float realX = std::lround(x * axisScaleX) / actualStepsPerMmX;
    const float realY = std::lround(y * axisScaleY) / actualStepsPerMmY;
    worstError = std::max(worstError, std::abs(std::hypot(realX - 20, realY - 25) - 16));
  }
  check(worstError < 0.8f, "circle stays round under independently specified mechanics");

  physicalX = -250; physicalY = -850;
  check(calibrate(40.5f, 50.5f) && xMin == -40 && xMax == 0 && yMin == -50 && yMax == 0 &&
        std::abs(axisScaleX - 250.0f / 40.5f) < 0.0001f &&
        std::abs(axisScaleY - 850.0f / 50.5f) < 0.0001f,
        "negative travel and fractional measurements keep limits inside measured travel");
  for (float invalid : {0.0f, -1.0f, 0.5f, 10001.0f,
                        std::numeric_limits<float>::infinity(),
                        std::numeric_limits<float>::quiet_NaN()}) {
    const auto before = snapshot();
    check(!calibrate(invalid, 50) && snapshot() == before,
          "invalid X measurement leaves calibration and saved state unchanged");
    check(!calibrate(40, invalid) && snapshot() == before,
          "invalid Y measurement leaves calibration and saved state unchanged");
  }
  physicalX = 0;
  const auto before = snapshot();
  check(!calibrate(40, 50) && snapshot() == before, "cannot calibrate an axis with zero travel");

  physicalX = 250; physicalY = 850;
  calibrate(40, 50);
  axisScaleX = axisScaleY = 1; calibrated = measuredCalibration = false;
  loadCalibrationUnderTest();
  check(calibrated && measuredCalibration && axisScaleX == 6.25f && axisScaleY == 17.0f &&
        xMax == 40 && yMax == 50, "measured calibration restores from saved configuration");
  prefs.values["calVersion"] = 2;
  prefs.values["xMax"] = 230; prefs.values["yMax"] = 850;
  prefs.values["scaleX"] = 250.0 / 230; prefs.values["scaleY"] = 1;
  loadCalibrationUnderTest();
  check(calibrated && !measuredCalibration && xMax == 230 && yMax == 850 &&
        std::abs(axisScaleX - 250.0f / 230) < 0.0001f,
        "legacy limits retained without treating them as measured mm");
  setCalibrationOrigin();
  loadCalibrationUnderTest();
  check(!calibrated && !measuredCalibration && physicalX == 0 && physicalY == 0,
        "setting origin invalidates previous measurement, including after reload");
  return failures ? 1 : 0;
}
