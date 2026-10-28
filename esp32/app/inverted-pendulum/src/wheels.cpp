/**
 * @file wheels.cpp
 * @brief FS90Rの速度指令をPCA9685のPWMへ変換し、左右の車輪を制御する。
 */
#include "wheels.h"
#include "hardware_config.h"
#include <math.h>

/**
 * @brief 車輪用PCA9685が使うI2Cバスを保持する。
 * @param wire 教材側で開始するI2Cバス。
 */
Wheels::Wheels(TwoWire &wire) : pwm_(hardware::PcaAddress, wire) {
}

/**
 * @brief PCA9685を初期化してPWM周波数を設定し、全CHを停止する。
 * @return 初期化と停止処理が成功したらtrue。
 */
bool Wheels::begin() {
    available_ = initialized_ = pwm_.begin();
    if (!available_) {
        return false;
    }
    off();
    pwm_.setPWMFreq(hardware::PwmHz);
    off();
    return available_;
}

/**
 * @brief 全CHのPWMを無効化する。失敗しても残りのCHへ停止書き込みを試みる。
 */
void Wheels::off() {
    if (!initialized_) {
        return;
    }
    // 全CHを無効化する。I2C障害時も残りのCHへ停止書き込みを試みる。
    for (uint8_t ch = 0; ch < 16; ++ch) {
        if (pwm_.setPWM(ch, 0, 4096) != 0) {
            available_ = false;
        }
    }
}

/**
 * @brief 速度指令を中立・方向設定に従ってPWMパルスへ変換する。
 * @param ch 出力CH番号（0〜15）。
 * @param command 処理対象の指令。
 * @param neutral 停止時の中立パルス幅（µs）。
 * @param direction 取り付け方向による符号（+1または−1）。
 * @return 指令が有効でPWMを書き込めたらtrue。
 */
bool Wheels::write(uint8_t ch, float command, uint16_t neutral, int direction) {
    if (!isfinite(command) || command < -100 || command > 100) {
        return false;
    }
    const float us = neutral + direction * command * hardware::PulseSpanUs / 100;
    const uint16_t ticks = lroundf(us * hardware::PwmHz * 4096 / 1000000);
    return pwm_.setPWM(ch, 0, ticks) == 0;
}

/**
 * @brief 左右の進行方向の速度指令を出力し、エラー時は全CHの停止を試みる。
 * @param left 左車輪の速度指令（%、−100〜100）。
 * @param right 右車輪の速度指令（%、−100〜100）。
 * @return 両輪のPWM書き込みが成功したらtrue。
 */
bool Wheels::drive(float left, float right) {
    if (!available_) {
        return false;
    }
    if (write(hardware::LeftChannel, left, hardware::LeftNeutralUs, hardware::LeftDirection) &&
        write(hardware::RightChannel, right, hardware::RightNeutralUs, hardware::RightDirection)) {
        return true;
    }
    available_ = false;
    off();
    return false;
}
