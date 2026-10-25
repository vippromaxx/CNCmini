# ESP32-C5 recovery

Captured from COM8 on 2026-10-25. The extraction commands only read the device; no erase, write, or upload operation was performed.

## Device

- Chip: ESP32-C5 revision v1.2
- USB mode: USB-Serial/JTAG
- Base MAC: `10:bd:a3:dc:7f:60`
- Detected flash: 16 MB
- Secure Boot: disabled
- Flash Encryption: disabled
- Full flash SHA-256: `89BB1FE59E9C9973903990FE63FF5C9A0C3467748B53F6D814C112D11D58819A`

## Firmware

- Active slot: `app0` (selected by `otadata`)
- App image: valid ESP32-C5 image; checksum and validation hash verified by esptool
- Project name in image: `arduino-lib-builder`
- App version: `6671d0b`
- Compile time: `Sep 16 2026 21:18:10`
- ESP-IDF: `v5.5.5`
- App0 SHA-256: `705BE8154DD8ECB693FDD86B01093FAD672B9CB28228CA86D60072B166B2AEC9`
- The image contains MiniCNC strings, MQTT topics, WiFi configuration mode, `/api/status`, `/save`, and an embedded HTML configuration page.
- `app1.bin` is not recognized as a valid ESP32 image and is not the active slot.

## Partitions

| Name | Offset | Size |
|---|---:|---:|
| nvs | `0x9000` | `0x5000` |
| otadata | `0xe000` | `0x2000` |
| app0 | `0x10000` | `0x140000` |
| app1 | `0x150000` | `0x140000` |
| spiffs | `0x290000` | `0x160000` |
| coredump | `0x3f0000` | `0x10000` |

The extracted SPIFFS and coredump ranges are blank. NVS contains WiFi/MQTT configuration and CNC state. Recovered non-secret state includes `src_host=192.168.1.11`, position `(0, 0)`, limits `X=230`, `Y=850`, and `pen_up=110`. The raw NVS report contains credentials; keep it private and never commit it.

## Files

- `esp32c5_COM8_10bd_a3_dc_7f_60_flash16mb.bin` — complete 16 MB flash dump
- `partition-table.bin` — partition table
- `nvs.bin` — raw NVS partition
- `otadata.bin` — OTA selection data
- `app0.bin` — active firmware slot
- `app1.bin` — inactive/invalid slot contents
- `app0_image_info.txt` — esptool image verification output
- `embedded_web_1.html` — HTML configuration page extracted from firmware
- `nvs_dump_minimal.txt` — readable NVS key/value report
- `nvs_dump_blobs.txt` — raw decoded NVS blobs; contains sensitive credentials
