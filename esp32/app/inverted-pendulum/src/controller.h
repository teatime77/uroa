/**
 * @file controller.h
 * @brief 通信とI2Cから独立した倒立制御の校正、姿勢推定とPID演算を提供する。
 */
#pragma once
#include <stdint.h>

/**
 * @brief 車軸をX軸とする姿勢制御。角度は度、角速度は度/秒、出力は速度指令%。
 * @details 通信・I2Cから独立した姿勢推定と倒立制御。角度は度、速度は指令%。
 */
class BalanceController {
    public:
    /**
     * @brief PIDゲイン、速度指令上限、転倒角度と制御の向き。
     */
    struct Config {
        float kp;
        float ki;
        float kd;
        float maxCommand;
        float fallAngle;
        int direction;
    };

    /**
     * @brief 加速度（g）とX角速度（度/秒）の1サンプル。
     */
    struct Sample {
        float ax;
        float ay;
        float az;
        float gx;
    }; // g, deg/s。X軸を車軸方向に取り付ける。
    /**
     * @brief 校正、制御中、停止、転倒、異常の状態。停止後は自動再始動しない。
     */
    enum class Mode : uint8_t {
        Calibrating,
        Running,
        Stopped,
        Fallen,
        Fault
    };

    /**
     * @brief 教材の制御設定を保持し、校正待ち状態で構築する。
     * @param config 教材側から渡す設定。
     */
    explicit BalanceController(const Config &config) : config_(config) {
    }

    /**
     * @brief 静止時の100サンプルで目標姿勢とジャイロのbiasを固定する。
     * @details 起動後の100サンプル（約1秒）を静止状態で取り、初期姿勢とgyro biasを固定。
     * @param sample 加速度（g）とX角速度（度/秒）のサンプル。
     * @return 今回のサンプルで校正が完了したらtrue。不正な値や動きはFaultとして停止する。
     */
    bool calibrate(const Sample &sample);
    /**
     * @brief 相補フィルターとPID演算を進め、周期超過や転倒を検査する。
     * @param sample 加速度（g）とX角速度（度/秒）のサンプル。
     * @param dt 前回の制御更新からの経過時間（秒）。
     */
    void update(const Sample &sample, float dt);
    /**
     * @brief 最初の停止理由を保持し、速度指令と積分項を0にする。
     * @param reason 切断理由または制御の停止理由。
     * @param fault 異常箇所を示す文字列リテラル。最初のFaultだけを記録する。
     * @param detail 異常を検出した値。単位は異常箇所ごとに定義する。
     */
    void stop(Mode reason = Mode::Stopped, const char *fault = "unspecified", float detail = 0);

    /** @brief 最初に検出した異常箇所を取得する。@return 異常なしはnone。 */
    const char *fault() const {
        return fault_;
    }

    /** @brief 異常検出時の値を取得する。@return 異常箇所に対応する測定値。 */
    float faultDetail() const {
        return faultDetail_;
    }

    /** @brief 起動校正で受理したサンプル数を取得する。@return 校正サンプル数（0〜100）。 */
    uint16_t calibrationSamples() const {
        return count_;
    }

    /**
     * @brief 現在の制御状態を取得する。
     * @return 校正中、制御中または停止理由を表す状態。
     */
    Mode mode() const {
        return mode_;
    }

    /**
     * @brief 推定姿勢角を取得する。
     * @return 推定姿勢角（度）。
     */
    float angle() const {
        return angle_;
    }

    /**
     * @brief 起動校正で決めた目標角を取得する。
     * @return 目標姿勢角（度）。
     */
    float target() const {
        return target_;
    }

    /**
     * @brief bias補正後のX角速度を取得する。
     * @return X角速度（度/秒）。
     */
    float rate() const {
        return rate_;
    }

    /**
     * @brief 姿勢角と目標角の差を周回補正して返す。
     * @return 姿勢誤差（度）。
     */
    float error() const;

    /**
     * @brief 最新の進行方向の速度指令を取得する。
     * @return 速度指令（%）。停止中は0。
     */
    float command() const {
        return command_;
    }

    private:
    Config config_;
    Mode mode_ = Mode::Calibrating;
    const char *fault_ = "none"; ///< 最初のFaultの箇所。文字列リテラルのみを保持する。
    float faultDetail_ = 0; ///< 最初のFaultを検出した値。
    uint16_t count_ = 0;
    float sumY_ = 0;
    float sumZ_ = 0;
    float sumGyro_ = 0;
    float firstAngle_ = 0;
    float bias_ = 0;
    float angle_ = 0;
    float target_ = 0;
    float rate_ = 0;
    float integral_ = 0;
    float command_ = 0;
};
