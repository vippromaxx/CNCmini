#pragma once

#include <Arduino.h>
#include <driver/gpio.h>
#include <math.h>

// DHT22 GPIO adapter for Wokwi. The physical CNC keeps its original DHT driver.
// Each pulse has a time limit and a second iteration limit; neither a missing
// sensor nor a stopped simulator timer can leave interrupts disabled forever.
class WokwiDHT {
public:
  WokwiDHT(uint8_t pin, uint8_t) : pin_(static_cast<gpio_num_t>(pin)) {}

  void begin() { pinMode(pin_, INPUT_PULLUP); }

  float readTemperature() {
    read();
    return temperature_;
  }

  float readHumidity() { return humidity_; }

private:
  struct CriticalSection {
    portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;
    CriticalSection() { portENTER_CRITICAL(&mux); }
    ~CriticalSection() { portEXIT_CRITICAL(&mux); }
  };

  uint32_t pulse(int level) {
    const uint32_t start = micros();
    for (unsigned attempts = 0; attempts < 4096; ++attempts) {
      const uint32_t elapsed = micros() - start;
      if (gpio_get_level(pin_) != level) return elapsed ? elapsed : 1;
      if (elapsed >= 200) return 0;
    }
    return 0;
  }

  bool receive(uint8_t (&data)[5]) {
    CriticalSection critical;
    pinMode(pin_, INPUT_PULLUP);
    delayMicroseconds(40);
    if (!pulse(LOW) || !pulse(HIGH)) return false;
    for (unsigned bit = 0; bit < 40; ++bit) {
      const uint32_t low = pulse(LOW);
      const uint32_t high = pulse(HIGH);
      if (!low || !high) return false;
      data[bit / 8] = (data[bit / 8] << 1) | (high > low);
    }
    return true;
  }

  void read() {
    const uint32_t now = millis();
    if (hasRead_ && now - lastRead_ < 2000) return;
    hasRead_ = true;
    lastRead_ = now;
    temperature_ = humidity_ = NAN;
    pinMode(pin_, INPUT_PULLUP);
    delay(1);
    pinMode(pin_, OUTPUT);
    digitalWrite(pin_, LOW);
    delayMicroseconds(1100);
    uint8_t data[5] = {};
    if (!receive(data)) return;
    if (static_cast<uint8_t>(data[0] + data[1] + data[2] + data[3]) != data[4]) return;
    const float humidity = ((uint16_t(data[0]) << 8) | data[1]) * 0.1f;
    float temperature = ((uint16_t(data[2] & 0x7f) << 8) | data[3]) * 0.1f;
    if (data[2] & 0x80) temperature = -temperature;
    if (humidity > 100 || temperature < -40 || temperature > 80) return;
    humidity_ = humidity;
    temperature_ = temperature;
  }

  gpio_num_t pin_;
  bool hasRead_ = false;
  uint32_t lastRead_ = 0;
  float temperature_ = NAN;
  float humidity_ = NAN;
};
