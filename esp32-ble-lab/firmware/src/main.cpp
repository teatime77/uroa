#include <Arduino.h>
#include <Wire.h>
#include <uroa_ble.h>
#include <uroa_imu.h>
#include <uroa_protocol.h>
#include <uroa_servo.h>
#include <atomic>
#include "config.h"
#include "network.h"

namespace {
using uroa::Protocol;
using uroa::Pca9685Servos;
uroa::BleTransport bluetooth;
uroa::Mpu6050 imu(Wire);
Pca9685Servos::Config servoConfig() {
    Pca9685Servos::Config config;
    config.address = PCA_ADDRESS; config.frequency = SERVO_FREQUENCY;
    config.minAngle = MIN_ANGLE; config.maxAngle = MAX_ANGLE;
    config.minPulseUs = MIN_PULSE_US; config.maxPulseUs = MAX_PULSE_US;
    return config;
}
Pca9685Servos servos(Wire, servoConfig());
struct Queued {
    Protocol::Command command;
    uint32_t session;
    bool wifi = false;
};
QueueHandle_t commands;
std::atomic<bool> mustStop{false}, urgentStop{false};
std::atomic<uint16_t> urgentSeq{0};
uint16_t streamHz = 0, sampleSeq = 0;
uint32_t lastCommand = 0, lastSample = 0;

uint8_t stateFlags() {
    return (servos.available() ? 1 : 0) | (imu.available() ? 2 : 0) |
        (servos.anyArmed() ? 4 : 0) | (streamHz ? 8 : 0);
}
void status(uint8_t code, uint16_t sequence, uint8_t channel = 255) {
    uint8_t packet[12];
    const auto *state = servos.state(channel);
    Protocol::status(packet, code, sequence, stateFlags(), channel,
        state ? state->current : 0, state ? state->target : 0,
        servos.remaining(channel, millis()));
    if (!network.bleUnavailable()) bluetooth.publishStatus(packet, sizeof packet);
    network.publish(packet, sizeof packet);
}
// 通信コールバックはデータをコピーするだけ。I2C操作・応答はloop()へ集約する。
void receive(const uint8_t *data, size_t length, uint32_t generation, bool wifi) {
    if (!wifi && network.connected()) return;
    if (wifi && length != 10) return;
    if (Protocol::urgentStop(data, length)) {
        urgentSeq = Protocol::read16(data + 2); urgentStop = true; return;
    }
    Queued queued{};
    queued.command = Protocol::command(data, length);
    queued.session = generation; queued.wifi = wifi;
    if (xQueueSend(commands, &queued, 0) != pdTRUE) {
        mustStop = true;
        if (wifi) network.stopControl();
    }
}
uint8_t resultCode(Pca9685Servos::Result result) {
    switch (result) {
    case Pca9685Servos::Result::Ok: return Protocol::CODE_OK;
    case Pca9685Servos::Result::Range: return Protocol::CODE_RANGE;
    case Pca9685Servos::Result::Unavailable: return Protocol::CODE_HARDWARE;
    case Pca9685Servos::Result::NotArmed: return Protocol::CODE_NOT_ARMED;
    default: return Protocol::CODE_IO_ERROR;
    }
}
void handle(const Protocol::Command &command) {
    const auto *b = command.bytes;
    const uint16_t sequence = Protocol::read16(b + 2);
    const uint16_t value = Protocol::read16(b + 6), duration = Protocol::read16(b + 8);
    const uint8_t op = b[1], channel = b[4];
    if (!Protocol::valid(command)) { status(Protocol::CODE_FORMAT, sequence); return; }
    lastCommand = millis();
    if (op == Protocol::PING || op == Protocol::INFO) { status(Protocol::CODE_OK, sequence, channel); return; }
    if (op == Protocol::STREAM) {
        if (value != 0 && value != 5 && value != 10 && value != 20) { status(Protocol::CODE_RANGE, sequence); return; }
        if (value && !imu.available()) { status(Protocol::CODE_HARDWARE, sequence); return; }
        streamHz = value; lastSample = millis(); status(Protocol::CODE_OK, sequence); return;
    }
    if (op == Protocol::STOP) { servos.allOff(); status(Protocol::CODE_OK, sequence); return; }
    if (channel >= 16) { status(Protocol::CODE_RANGE, sequence); return; }
    Pca9685Servos::Result result;
    if (op == Protocol::DISABLE) result = servos.disable(channel);
    else if (op == Protocol::ARM) result = servos.arm(channel, value, duration);
    else result = servos.move(channel, value, duration, millis());
    // 出力失敗の自発通知と、その指令への受付結果を従来どおり別々に返す。
    if (result == Pca9685Servos::Result::IoError && op != Protocol::DISABLE)
        status(Protocol::CODE_IO_ERROR, 0, channel);
    status(resultCode(result), sequence, channel);
}
}

void setup() {
    Serial.begin(115200); delay(200);
    const bool i2cStarted = Wire.begin(SDA_PIN, SCL_PIN);
    Wire.setClock(100000); Wire.setTimeOut(30);
    Serial.println("ESP32 BLE Lab: servo outputs OFF at startup");
    Serial.printf("I2C config: SDA=GPIO%d SCL=GPIO%d clock=100000 Hz init=%s\n",
        SDA_PIN, SCL_PIN, i2cStarted ? "OK" : "FAILED");
    Serial.print("I2C:");
    for (uint8_t address = 1; address < 127; ++address) {
        Wire.beginTransmission(address);
        if (Wire.endTransmission() == 0) Serial.printf(" 0x%02X", address);
    }
    Serial.println();
    servos.begin(); imu.begin();
    Serial.printf("PCA9685=%s MPU6050=%s (0x%02X)\n",
        servos.available() ? "OK" : "MISSING", imu.available() ? "OK" : "MISSING", imu.address());
    commands = xQueueCreate(16, sizeof(Queued));
    if (!commands) { Serial.println("Queue allocation failed"); while (true) delay(1000); }

    uroa::WifiNetwork::Callbacks wifiCallbacks;
    wifiCallbacks.command = [](const uint8_t *data, size_t length, uint32_t generation) { receive(data, length, generation, true); };
    wifiCallbacks.session = [](bool, uint32_t) { mustStop = true; };
    wifiCallbacks.startBLE = [] { bluetooth.start(); };
    wifiCallbacks.stopBLE = [] { bluetooth.stop(); };
    beginNetwork(wifiCallbacks);

    uroa::BleTransport::Config bleConfig;
    bleConfig.name = DEVICE_NAME; bleConfig.serviceUuid = SERVICE_UUID;
    bleConfig.commandUuid = COMMAND_UUID; bleConfig.telemetryUuid = TELEMETRY_UUID;
    bleConfig.statusUuid = STATUS_UUID; bleConfig.configUuid = CONFIG_UUID; bleConfig.resultUuid = RESULT_UUID;
    bleConfig.passkey = PAIRING_CODE;
    uroa::BleTransport::Callbacks bleCallbacks;
    bleCallbacks.command = [](const uint8_t *data, size_t length, uint32_t generation) { receive(data, length, generation, false); };
    bleCallbacks.session = [](bool, uint32_t) { mustStop = true; };
    bleCallbacks.configure = [](const String &input) { return network.configure(input); };
    bleCallbacks.started = [] { status(Protocol::CODE_OK, 0); };
    bluetooth.begin(bleConfig, bleCallbacks);
    Serial.printf("BLE address: %s\n", NimBLEDevice::getAddress().toString().c_str());
}
void loop() {
    uint32_t now = millis();
    if (mustStop.exchange(false)) {
        servos.allOff(); streamHz = 0; lastCommand = now;
        xQueueReset(commands); status(Protocol::CODE_OK, 0);
    }
    if (urgentStop.exchange(false)) {
        servos.allOff(); xQueueReset(commands); lastCommand = now;
        status(Protocol::CODE_OK, urgentSeq);
    }
    Queued queued;
    // 1周4件までに制限し、補間と期限監視の処理時間を残す。
    for (int n = 0; n < 4 && xQueueReceive(commands, &queued, 0) == pdTRUE; ++n)
        if ((queued.wifi && network.connected() && queued.session == network.generation()) ||
            (!queued.wifi && !network.connected() && bluetooth.connected() && queued.session == bluetooth.generation()))
            handle(queued.command);
    now = millis();
    if ((bluetooth.connected() || network.connected()) && now - lastCommand > HEARTBEAT_TIMEOUT_MS) {
        if (servos.anyArmed() || streamHz) {
            servos.allOff(); streamHz = 0; status(Protocol::CODE_NOT_ARMED, 0);
        }
        network.stopControl();
    }
    const int failedChannel = servos.tick(now);
    if (failedChannel >= 0) status(Protocol::CODE_IO_ERROR, 0, failedChannel);
    if ((bluetooth.connected() || network.connected()) && imu.available() && streamHz && now - lastSample >= 1000 / streamHz) {
        lastSample = now;
        uint8_t raw[14];
        if (!imu.readRaw(raw)) { streamHz = 0; status(Protocol::CODE_IO_ERROR, 0); }
        else {
            uint8_t packet[20];
            Protocol::telemetry(packet, stateFlags(), ++sampleSeq, now, raw);
            if (!network.bleUnavailable()) bluetooth.publishTelemetry(packet, sizeof packet);
            network.publish(packet, sizeof packet);
        }
    }
    network.tick();
    delay(2);
}
