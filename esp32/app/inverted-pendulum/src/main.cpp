/**
 * @file main.cpp
 * @brief 2輪倒立ロボットの起動、制御タスク、BLE通信を管理する。
 * @details 起動時の静止姿勢を目標に100Hzで制御し、IMUと速度指令を通知する。
 *          I2C操作は制御タスク、BLE通知はloop()で行う。
 */
#include <Arduino.h>
#include <Wire.h>
#include <uroa_ble.h>
#include <uroa_imu.h>
#include <uroa_protocol.h>
#include <uroa_plot.h>
#include <atomic>
#include <string.h>
#include "hardware_config.h"
#include "controller.h"
#include "wheels.h"

namespace {
    using uroa::Protocol;

    uroa::BleTransport bluetooth; ///< BLE接続と通知を管理する。
    uroa::Mpu6050 imu(Wire); ///< 共通I2Cバス上のIMU。
    Wheels wheels(Wire); ///< 左右のFS90Rへの出力。
    BalanceController controller({hardware::Kp, hardware::Ki, hardware::Kd,
        hardware::MaxCommand, hardware::FallAngleDeg, hardware::ControlDirection}); ///< 姿勢推定と倒立制御。

    /** @brief 受信指令と、その受信時のBLE接続世代を保持する。 */
    struct Queued {
        Protocol::Command command; ///< 受信した指令のコピー。
        uint32_t generation; ///< 古い接続の指令を除外するための世代。
    };

    /** @brief 制御タスクからloop()へ渡すStatus通知。 */
    struct Reply {
        uint8_t packet[12]; ///< protocol v1のStatusパケット。
    };

    /** @brief 制御タスクから通知処理へ渡す、同一周期の状態。 */
    struct Snapshot {
        uint8_t raw[14]{}; ///< IMUの生データ。センサーのbig endian形式。
        float angle = 0; ///< 推定姿勢角。単位は度。
        float target = 0; ///< 起動時に校正した目標角。単位は度。
        float rate = 0; ///< bias補正後のX角速度。単位は度/秒。
        float error = 0; ///< 姿勢角と目標角の差。単位は度。
        float left = 0; ///< 左車輪の速度指令。単位は%。
        float right = 0; ///< 右車輪の速度指令。単位は%。
        uint32_t time = 0; ///< スナップショット更新時刻。単位はms。
        bool pca = false; ///< PCA9685が利用可能か。
        bool imu = false; ///< IMUが利用可能か。
        BalanceController::Mode mode = BalanceController::Mode::Calibrating; ///< 制御状態。
        const char *fault = "none"; ///< 最初のFaultの箇所を示す文字列リテラル。
        float faultDetail = 0; ///< 異常検出時の値。単位はfaultに含める。
        uint16_t calibrationSamples = 0; ///< 校正で受理したサンプル数。
    };

    QueueHandle_t commands; ///< BLE受信指令のキュー。
    QueueHandle_t replies; ///< BLE通知待ちのStatusキュー。
    portMUX_TYPE snapshotMux = portMUX_INITIALIZER_UNLOCKED; ///< 状態コピーの排他制御。
    Snapshot snapshot; ///< 最新の制御状態。
    std::atomic<bool> mustStop{false}; ///< 切断やキュー飽和による停止要求。
    std::atomic<bool> urgentStop{false}; ///< 通常キューを迂回するSTOP要求。
    std::atomic<bool> sessionChanged{false}; ///< BLE接続世代が変わったか。
    std::atomic<uint16_t> urgentSequence{0}; ///< STOPへ応答するsequence。
    std::atomic<uint16_t> streamHz{0}; ///< 通知周期。0は通知停止。
    constexpr char FirmwareTag[] = "inverted-pendulum-diag-20261027-2"; ///< 書き込み済み版を識別する診断タグ。
    uint32_t balanceAttempts = 0; ///< loop()からBalanceの送信を試みた回数。
    uint32_t balanceSent = 0; ///< BalanceをBLE送信APIが受理した回数。受信数ではない。
    uint32_t imuAttempts = 0; ///< loop()からIMUの送信を試みた回数。
    uint32_t imuSent = 0; ///< IMUをBLE送信APIが受理した回数。受信数ではない。

    /**
     * @brief 最新の制御状態を排他制御下でコピーする。
     * @return 同一制御周期のスナップショット。
     */
    Snapshot current() {
        portENTER_CRITICAL(&snapshotMux);
        const Snapshot result = snapshot;
        portEXIT_CRITICAL(&snapshotMux);
        return result;
    }

    /**
     * @brief 状態と現在の通知設定からprotocol v1のフラグを組み立てる。
     * @param s 機器と制御の状態。
     * @return bit0=PCA正常、bit1=IMU正常、bit2=制御中、bit3=通知有効。
     */
    uint8_t stateFlags(const Snapshot &s) {
        return (s.pca ? 1 : 0) | (s.imu ? 2 : 0) |
            (s.mode == BalanceController::Mode::Running ? 4 : 0) | (streamHz ? 8 : 0);
    }

    /**
     * @brief センサーのbig endian値を符号付き16bit整数へ変換する。
     * @param p 読み取る2バイトの先頭。
     * @return 符号付きの生データ。
     */
    int16_t raw16(const uint8_t *p) {
        return int16_t(uint16_t(p[0]) << 8 | p[1]);
    }

    /**
     * @brief IMUの生データを制御器用の加速度とX角速度へ変換する。
     * @param raw 加速度・温度・角速度を含む14バイトの生データ。
     * @return 加速度はg、角速度は度/秒のサンプル。
     */
    BalanceController::Sample sample(const uint8_t *raw) {
        return {raw16(raw) / 16384.0f, raw16(raw + 2) / 16384.0f,
            raw16(raw + 4) / 16384.0f, raw16(raw + 8) / 131.0f};
    }

    /**
     * @brief 制御器と機器の状態を通知用に公開する。
     * @param raw 今回取得したIMUの生データ。
     * @details 機器を所有する制御タスクから呼ぶ。タスク開始前はsetup()から呼ぶ。
     */
    void updateSnapshot(const uint8_t (&raw)[14]) {
        Snapshot next;
        memcpy(next.raw, raw, sizeof raw);
        next.angle = controller.angle();
        next.target = controller.target();
        next.rate = controller.rate();
        next.error = controller.error();
        next.left = next.right = controller.command();
        next.time = millis();
        next.pca = wheels.available();
        next.imu = imu.available();
        next.mode = controller.mode();
        next.fault = controller.fault();
        next.faultDetail = controller.faultDetail();
        next.calibrationSamples = controller.calibrationSamples();
        portENTER_CRITICAL(&snapshotMux);
        snapshot = next;
        portEXIT_CRITICAL(&snapshotMux);
    }

    /**
     * @brief Status応答を通知キューへ入れ、飽和時は停止を要求する。
     * @param code protocol v1の応答コード。
     * @param seq 応答先のsequence。0は自発通知。
     * @details 制御タスクではBLE通知を行わず、100HzのI2C処理を待たせない。
     */
    void reply(uint8_t code, uint16_t seq) {
        Reply result;
        Protocol::status(result.packet, code, seq, stateFlags(current()));
        if (xQueueSend(replies, &result, 0) != pdTRUE) {
            mustStop = true;
        }
    }

    /**
     * @brief BLE受信指令をコピーし、STOPだけは優先フラグへ渡す。
     * @param data コールバック中だけ有効な受信データ。
     * @param length 受信バイト数。
     * @param generation 指令を受信したBLE接続世代。
     * @details このコールバックではI2Cを操作しない。
     */
    void receive(const uint8_t *data, size_t length, uint32_t generation) {
        if (Protocol::urgentStop(data, length)) {
            urgentSequence = Protocol::read16(data + 2);
            urgentStop = true;
            return;
        }
        Queued queued{Protocol::command(data, length), generation};
        if (xQueueSend(commands, &queued, 0) != pdTRUE) {
            mustStop = true;
        }
    }

    /**
     * @brief 制御タスクで指令を検査し、通知設定や停止を実行する。
     * @param command キューから取り出した指令。
     * @param[in,out] lastCommand 最後に有効形式の指令を受けた時刻。単位はms。
     * @details ARM/MOVEは角度サーボ用のため、倒立制御への上書きや再始動に使わない。
     */
    void handle(const Protocol::Command &command, uint32_t &lastCommand) {
        const auto *b = command.bytes;
        const uint16_t seq = Protocol::read16(b + 2);
        const uint16_t value = Protocol::read16(b + 6);
        if (!Protocol::valid(command)) {
            reply(Protocol::CODE_FORMAT, seq);
            return;
        }
        lastCommand = millis();
        switch (b[1]) {
            case Protocol::PING:
            case Protocol::INFO:
                reply(Protocol::CODE_OK, seq);
                break;
            case Protocol::STREAM:
                if (value != 0 && value != 5 && value != 10 && value != 20) {
                    reply(Protocol::CODE_RANGE, seq);
                }
                else if (value && !imu.available()) {
                    reply(Protocol::CODE_HARDWARE, seq);
                }
                else {
                    streamHz = value;
                    reply(Protocol::CODE_OK, seq);
                }
                break;
            case Protocol::DISABLE:
                if (b[4] != hardware::LeftChannel && b[4] != hardware::RightChannel) {
                    reply(Protocol::CODE_RANGE, seq);
                }
                else {
                    controller.stop();
                    wheels.off();
                    uint8_t raw[14];
                    const auto s = current();
                    memcpy(raw, s.raw, sizeof raw);
                    updateSnapshot(raw);
                    reply(wheels.available() ? Protocol::CODE_OK : Protocol::CODE_IO_ERROR, seq);
                }
                break;
            default:
                reply(Protocol::CODE_BUSY, seq);
                break;
        }
    }

    /**
     * @brief 停止要求、指令、IMU取得、倒立制御と車輪出力を100Hzで処理する。
     * @details FreeRTOSのタスク引数は未使用。I2C操作をこのタスクへ集約し、
     *          BLE通知とログ出力はloop()へ任せる。
     */
    void controlTask(void *) {
        TickType_t wake = xTaskGetTickCount();
        uint32_t previous = micros();
        uint32_t lastCommand = millis();
        bool outputsOn = false;
        auto previousMode = controller.mode();
        uint8_t raw[14]{};
        for (;;) {
            if (sessionChanged.exchange(false)) {
                streamHz = 0;
                lastCommand = millis();
            }
            const bool stopped = mustStop.exchange(false);
            const bool urgent = urgentStop.exchange(false);
            if (stopped || urgent) {
                controller.stop();
                wheels.off();
                outputsOn = false;
                xQueueReset(commands);
                if (stopped) {
                    streamHz = 0;
                }
                updateSnapshot(raw);
                reply(wheels.available() ? Protocol::CODE_OK : Protocol::CODE_IO_ERROR,
                    urgent ? urgentSequence.load() : 0);
            }
            Queued queued;
            for (int n = 0; n < 4 && xQueueReceive(commands, &queued, 0) == pdTRUE; ++n) {
                if (bluetooth.connected() && queued.generation == bluetooth.generation()) {
                    handle(queued.command, lastCommand);
                }
            }
            if (bluetooth.connected() && millis() - lastCommand > hardware::HeartbeatMs) {
                if (controller.mode() == BalanceController::Mode::Running || streamHz) {
                    controller.stop();
                    streamHz = 0;
                    wheels.off();
                    outputsOn = false;
                    updateSnapshot(raw);
                    reply(Protocol::CODE_NOT_ARMED, 0);
                }
            }
            const uint32_t now = micros();
            const float dt = uint32_t(now - previous) * 0.000001f;
            previous = now;
            if (!imu.readRaw(raw)) {
                controller.stop(BalanceController::Mode::Fault, "imu_read");
            }
            else {
                controller.update(sample(raw), dt);
            }
            if (controller.mode() == BalanceController::Mode::Running) {
                outputsOn = true;
                if (!wheels.drive(controller.command(), controller.command())) {
                    controller.stop(BalanceController::Mode::Fault, "motor_write");
                }
            }
            if (outputsOn && controller.mode() != BalanceController::Mode::Running) {
                wheels.off();
                outputsOn = false;
            }
            updateSnapshot(raw);
            if (controller.mode() != previousMode) {
                previousMode = controller.mode();
                reply(previousMode == BalanceController::Mode::Fault ? Protocol::CODE_IO_ERROR : Protocol::CODE_NOT_ARMED, 0);
            }
            vTaskDelayUntil(&wake, pdMS_TO_TICKS(hardware::PeriodMs));
        }
    }

    /**
     * @brief 接続後やモニターを途中から開いた場合にも、現在の状態と通知の受付数を表示する。
     * @param s 表示する制御スナップショット。
     * @details loop()から呼ぶ。校正・制御タスクを待たせず、送信APIの受付と相手の受信を区別する。
     */
    void logDiagnostics(const Snapshot &s) {
        const float values[6] = {s.angle, s.target, s.rate, s.error, s.left, s.right};
        uint8_t packet[uroa::PlotTelemetry::PacketSize];
        const bool encodable = uroa::PlotTelemetry::encode(packet, 1, 0, s.time, values);
        Serial.printf("[balance] fw=%s mode=%u pca=%u imu=%u stream=%u encode=%s balance=%lu/%lu imuTx=%lu/%lu angle=%.2f target=%.2f rate=%.2f motor=%.2f fault=%s detail=%.3f cal=%u/100\n",
            FirmwareTag, unsigned(s.mode), unsigned(s.pca), unsigned(s.imu), unsigned(streamHz.load()),
            encodable ? "OK" : "INVALID", static_cast<unsigned long>(balanceSent), static_cast<unsigned long>(balanceAttempts),
            static_cast<unsigned long>(imuSent), static_cast<unsigned long>(imuAttempts), s.angle, s.target, s.rate, s.left,
            s.fault, s.faultDetail, unsigned(s.calibrationSamples));
    }

    /** @brief 同一スナップショットの6系列をBLEプロット通知へ変換し、送信APIの受付数を記録する。 */
    uroa::PlotTelemetry plot(1, [](const uint8_t *data, size_t length) {
        ++balanceAttempts;
        if (bluetooth.publishTelemetry(data, length)) {
            ++balanceSent;
        }
    });
}

/**
 * @brief 機器の初期化、起動姿勢の校正、制御タスクとBLEの開始を行う。
 * @details USB接続を待たずに起動姿勢を取得する。校正成功後はBLE接続を待たずに
 *          制御を開始し、キューやタスクを作成できなければ車輪出力を停止する。
 */
void setup() {
    Serial.begin(115200);
    const bool bus = Wire.begin(hardware::Sda, hardware::Scl);
    Wire.setClock(100000);
    Wire.setTimeOut(5);
    const bool pcaReady = bus && wheels.begin();
    const bool imuReady = bus && imu.begin();
    uint8_t raw[14]{};
    if (!pcaReady || !imuReady) {
        controller.stop(BalanceController::Mode::Fault, !bus ? "i2c_begin" : !pcaReady ? "pca_begin" : "imu_begin");
    }
    else {
        /** @brief MPUのPLLとフィルターが安定するまで待つ。 */
        delay(100);
        for (int n = 0; n < 100; ++n) {
            if (!imu.readRaw(raw)) {
                controller.stop(BalanceController::Mode::Fault, "cal_imu_read");
                break;
            }
            if (abs(raw16(raw + 10)) > 655) {
                controller.stop(BalanceController::Mode::Fault, "cal_gyro_y_dps", raw16(raw + 10) / 131.0f);
                break;
            }
            if (abs(raw16(raw + 12)) > 655) {
                controller.stop(BalanceController::Mode::Fault, "cal_gyro_z_dps", raw16(raw + 12) / 131.0f);
                break;
            }
            controller.calibrate(sample(raw));
            if (controller.mode() == BalanceController::Mode::Fault) {
                break;
            }
            delay(hardware::PeriodMs);
        }
    }
    updateSnapshot(raw);
    Serial.printf("I2C SDA=%d SCL=%d PCA=%s IMU=%s target=%.2f mode=%u\n",
        hardware::Sda, hardware::Scl, pcaReady ? "OK" : "MISSING", imuReady ? "OK" : "MISSING",
        controller.target(), unsigned(controller.mode()));
    commands = xQueueCreate(16, sizeof(Queued));
    replies = xQueueCreate(16, sizeof(Reply));
    if (!commands || !replies) {
        wheels.off();
        Serial.println("Queue allocation failed");
        while (true) {
            delay(1000);
        }
    }
    /** @brief 制御タスクをcore 1の優先度3で開始する。 */
    if (xTaskCreatePinnedToCore(controlTask, "balance", 4096, nullptr, 3, nullptr, 1) != pdPASS) {
        wheels.off();
        Serial.println("Control task allocation failed");
        while (true) {
            delay(1000);
        }
    }
    uroa::BleTransport::Config config;
    config.name = hardware::DeviceName;
    config.serviceUuid = hardware::ServiceUuid;
    config.commandUuid = hardware::CommandUuid;
    config.telemetryUuid = hardware::TelemetryUuid;
    config.statusUuid = hardware::StatusUuid;
    uroa::BleTransport::Callbacks callbacks;
    callbacks.command = receive;
    callbacks.session = [](bool connected, uint32_t) {
        sessionChanged = true;
        /** @brief 初回接続では自律制御を続け、切断時に停止を要求する。 */
        if (!connected) {
            mustStop = true;
        }
    };
    callbacks.started = [] {
        uint8_t packet[12];
        Protocol::status(packet, Protocol::CODE_OK, 0, stateFlags(current()));
        bluetooth.publishStatus(packet, sizeof packet);
    };
    bluetooth.begin(config, callbacks);
}

/**
 * @brief Status、制御状態ログ、プロットとIMUのBLE通知を処理する。
 * @details 制御タスクからコピーした同一スナップショットを使い、
 *          プロットとIMUの各通知をBLE既定MTUに収まる20バイトで送る。
 */
void loop() {
    Reply result;
    for (int n = 0; n < 4 && xQueueReceive(replies, &result, 0) == pdTRUE; ++n) {
        bluetooth.publishStatus(result.packet, sizeof result.packet);
    }
    const auto s = current();
    static int lastMode = -1;
    const bool modeChanged = lastMode != int(s.mode);
    if (modeChanged) {
        lastMode = int(s.mode);
        Serial.printf("Balance mode=%d (0=calibrating 1=running 2=stopped 3=fallen 4=fault) target=%.2f\n", lastMode, s.target);
    }
    const uint16_t hz = bluetooth.connected() && s.imu ? streamHz.load() : 0;
    plot.setRate(hz);
    const float values[6] = {s.angle, s.target, s.rate, s.error, s.left, s.right};
    if (plot.publish(s.time, values)) {
        static uint16_t sequence = 0;
        uint8_t packet[20];
        Protocol::telemetry(packet, stateFlags(s), ++sequence, s.time, s.raw);
        ++imuAttempts;
        if (bluetooth.publishTelemetry(packet, sizeof packet)) {
            ++imuSent;
        }
    }
    static uint32_t lastDiagnostic = 0;
    static uint32_t lastConnection = 0;
    const uint32_t now = millis();
    const uint32_t connection = bluetooth.generation();
    if (modeChanged || connection != lastConnection || now - lastDiagnostic >= 5000) {
        lastDiagnostic = now;
        lastConnection = connection;
        logDiagnostics(s);
    }
    delay(1);
}
