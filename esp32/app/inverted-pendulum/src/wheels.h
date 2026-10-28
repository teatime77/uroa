/**
 * @file wheels.h
 * @brief FS90Rの速度指令をPCA9685のPWMへ変換し、左右の車輪を制御する。
 */
#pragma once
#include <Adafruit_PWMServoDriver.h>

/**
 * @brief 連続回転サーボFS90Rの速度指令と停止を扱う。角度サーボAPIとは分離する。
 * @details FS90Rの速度指令をPCA9685のパルス幅へ変換する。角度サーボAPIとは分離する。
 */
class Wheels {
    public:
    /**
     * @brief 車輪用PCA9685が使うI2Cバスを保持する。
     * @param wire 教材側で開始するI2Cバス。
     */
    explicit Wheels(TwoWire &wire);
    /**
     * @brief PCA9685を初期化してPWM周波数を設定し、全CHを停止する。
     * @return 初期化と停止処理が成功したらtrue。
     */
    bool begin();
    /**
     * @brief 左右の進行方向の速度指令を出力し、エラー時は全CHの停止を試みる。
     * @param left 左車輪の速度指令（%、−100〜100）。
     * @param right 右車輪の速度指令（%、−100〜100）。
     * @return 両輪のPWM書き込みが成功したらtrue。
     */
    bool drive(float left, float right);
    /**
     * @brief 全CHのPWMを無効化する。失敗しても残りのCHへ停止書き込みを試みる。
     */
    void off();

    /**
     * @brief PCA9685の利用可否を取得する。
     * @return 初期化済みで出力エラーがなければtrue。
     */
    bool available() const {
        return available_;
    }

    private:
    /**
     * @brief 速度指令を中立・方向設定に従ってPWMパルスへ変換する。
     * @param channel 出力CH番号。
     * @param command 処理対象の指令。
     * @param neutral 停止時の中立パルス幅（µs）。
     * @param direction 取り付け方向による符号（+1または−1）。
     * @return 指令が有効でPWMを書き込めたらtrue。
     */
    bool write(uint8_t channel, float command, uint16_t neutral, int direction);
    Adafruit_PWMServoDriver pwm_;
    bool available_ = false;
    bool initialized_ = false;
};
