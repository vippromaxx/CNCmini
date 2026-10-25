# MiniCNC recovery in this project

The original source tree was missing, so the project now contains two kinds of material:

1. **Observed recovery artefacts** in `recovery/` and `firmware-recovered/`. These are copied from the ESP32-C5 flash dump and must be treated as authoritative for the captured device.
2. **Reconstructed source** in the PlatformIO project `C:\Users\ThinkPad\Documents\PlatformIO\Projects\CNC\src\main.cpp` plus `broker/`, `web/`, and `database/` in this folder. This source follows the recovered firmware strings, NVS values, MQTT notes and architecture documents. It is a clean replacement, not a byte-for-byte recovery of the lost source.

## Recovered evidence

- `recovery/esp32c5_COM8_10bd_a3_dc_7f_60_flash16mb.bin`: complete 16 MB flash dump.
- `firmware-recovered/esp32c5-app0.bin`: active app slot copied from the dump.
- `web/config.html`: configuration page extracted from the firmware image.
- `recovery/nvs_dump_blobs.txt`: decoded NVS, including sensitive WiFi and MQTT values. Keep private.
- `recovery/app0_protocol_strings.txt`: strings related to MQTT, HTTP, pins and MiniCNC behavior.

The dump was verified as ESP32-C5 revision 1.2, with Secure Boot and Flash Encryption disabled. The active app image is valid and was compiled with Arduino-ESP32/ESP-IDF 5.5.5. The captured NVS state included broker host `192.168.1.11`, device `cnc01`, position `(0, 0)`, X limit `230`, Y limit `850`, and pen-up angle `110`.

## Restored project pieces

- `C:\Users\ThinkPad\Documents\PlatformIO\Projects\CNC\src\main.cpp`: Arduino firmware reconstruction with WiFi configuration AP, NVS settings, MQTT topic tree, jog, pen, LED, calibration, job loading and retained status.
- `broker/broker.js`: Node.js/Aedes TCP broker on port 1883, MQTT over WebSocket and dashboard on port 9001, authentication, admin checks, machine lock and optional MariaDB logging.
- `web/index.html`, `web/script.js`, `web/style.css`: working dashboard for connection, status, jog, pen, calibration, shapes and image upload.
- `database/schema.sql`: MariaDB schema for `commands`, `images` and `status_log`.
- `web/config.html`: original configuration page extracted from the firmware.

## Running the recovered stack

1. Copy `broker/users.json.example` to `broker/users.json` and set private passwords.
2. In `broker/`, run `npm install` and then `npm start`.
3. Start MariaDB/XAMPP if database logging is needed; the broker remains usable when MariaDB is offline.
4. Build the firmware from `C:\Users\ThinkPad\Documents\PlatformIO\Projects\CNC` with the `esp32c5` environment. Copy `include/secrets.h.example` to `include/secrets.h` only if compile-time defaults are desired; runtime values are normally entered through the `KimPang` configuration AP at `192.168.4.1`.

Do not upload the reconstructed firmware until it has been tested against the captured device behavior. The original binary remains available in `firmware-recovered/` and the full dump remains available in `recovery/`.
