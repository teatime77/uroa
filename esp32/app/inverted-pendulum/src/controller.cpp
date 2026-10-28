/**
 * @file controller.cpp
 * @brief 通信とI2Cから独立した倒立制御の校正、姿勢推定とPID演算を提供する。
 */
#include "controller.h"
#include <math.h>

namespace {
    constexpr float RadToDeg = 57.2957795131f;

    /**
     * @brief 角度を360度周期の範囲へ折り返す。
     * @param angle 角度（度）。
     * @return 周回補正した角度（度）。
     */
    float wrap(float angle) {
        return remainderf(angle, 360.0f);
    }

    /**
     * @brief 値を正負の上限内へ制限する。
     * @param value 検査または変換する値。
     * @param bound 正負に適用する上限。
     * @return 制限後の値。
     */
    float limit(float value, float bound) {
        return fmaxf(-bound, fminf(bound, value));
    }

    /**
     * @brief 制御用センサー値がすべて有限か検査する。
     * @param s 加速度（g）とX角速度（度/秒）のサンプル。
     * @return 加速度とX角速度が有限ならtrue。
     */
    bool valid(const BalanceController::Sample &s) {
        return isfinite(s.ax) && isfinite(s.ay) && isfinite(s.az) && isfinite(s.gx);
    }
}

/**
 * @brief 姿勢角と目標角の差を周回補正して返す。
 * @return 姿勢誤差（度）。
 */
float BalanceController::error() const {
    return wrap(angle_ - target_);
}

/**
 * @brief 最初の停止理由を保持し、速度指令と積分項を0にする。
 * @param reason 切断理由または制御の停止理由。
 * @param fault 異常箇所を示す文字列リテラル。
 * @param detail 異常検出時の値。
 */
void BalanceController::stop(Mode reason, const char *fault, float detail) {
    // 停止理由は最初のものを保つ。STOP/転倒/異常からの自動再起動はしない。
    if (mode_ == Mode::Calibrating || mode_ == Mode::Running) {
        mode_ = reason;
        if (reason == Mode::Fault) {
            fault_ = fault;
            faultDetail_ = detail;
        }
    }
    command_ = integral_ = 0;
}

/**
 * @brief 静止時の100サンプルで目標姿勢とジャイロのbiasを固定する。
 * @param s 加速度（g）とX角速度（度/秒）のサンプル。
 * @return 今回のサンプルで校正が完了したらtrue。不正な値や動きはFaultとして停止する。
 */
bool BalanceController::calibrate(const Sample &s) {
    if (mode_ != Mode::Calibrating) {
        return false;
    }
    const float norm = sqrtf(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
    const float angle = atan2f(s.ay, s.az) * RadToDeg;
    if (!count_) {
        firstAngle_ = angle;
    }
    // 車軸が鉛直に近い取り付けや、起動中に動いた状態では有効化しない。
    if (!valid(s)) {
        stop(Mode::Fault, "cal_invalid_sample");
        return false;
    }
    if (norm < 0.85f || norm > 1.15f) {
        stop(Mode::Fault, "cal_gravity_g", norm);
        return false;
    }
    const float yz = hypotf(s.ay, s.az);
    if (yz < 0.7f) {
        stop(Mode::Fault, "cal_axis_g", yz);
        return false;
    }
    if (fabsf(s.gx) > 5.0f) {
        stop(Mode::Fault, "cal_gyro_x_dps", s.gx);
        return false;
    }
    const float change = wrap(angle - firstAngle_);
    if (fabsf(change) > 3.0f) {
        stop(Mode::Fault, "cal_motion_deg", change);
        return false;
    }
    sumY_ += s.ay;
    sumZ_ += s.az;
    sumGyro_ += s.gx;
    if (++count_ == 100) {
        angle_ = target_ = atan2f(sumY_, sumZ_) * RadToDeg;
        bias_ = sumGyro_ / count_;
        mode_ = Mode::Running;
        return true;
    }
    return false;
}

/**
 * @brief 相補フィルターとPID演算を進め、周期超過や転倒を検査する。
 * @param s 加速度（g）とX角速度（度/秒）のサンプル。
 * @param dt 前回の制御更新からの経過時間（秒）。
 */
void BalanceController::update(const Sample &s, float dt) {
    if (!valid(s)) {
        stop(Mode::Fault, "invalid_sample");
        return;
    }
    if (!isfinite(dt) || dt <= 0 || dt > 0.03f) {
        stop(Mode::Fault, "control_period_ms", dt * 1000);
        return;
    }
    rate_ = s.gx - bias_;
    const float accAngle = atan2f(s.ay, s.az) * RadToDeg;
    const float predicted = wrap(angle_ + rate_ * dt);
    const float norm = sqrtf(s.ax * s.ax + s.ay * s.ay + s.az * s.az);
    // 加減速中は加速度の信頼度を下げ、ジャイロ積分を優先する。
    const float correction = norm > 0.8f && norm < 1.2f ? dt / (0.5f + dt) : 0;
    angle_ = wrap(predicted + correction * wrap(accAngle - predicted));
    if (mode_ != Mode::Running) {
        return; // 停止後もグラフ用の姿勢推定は続ける。
    }
    if (fabsf(error()) > config_.fallAngle || fabsf(rate_) > 180) {
        stop(Mode::Fallen);
        return;
    }
    const float candidateIntegral = limit(integral_ + error() * dt, 30);
    const float demand = config_.kp * error() + config_.ki * candidateIntegral + config_.kd * rate_;
    // 飽和を増やす向きの積分を止め、転倒後の急発進を防ぐ。
    if (fabsf(demand) < config_.maxCommand || demand * error() < 0) {
        integral_ = candidateIntegral;
    }
    command_ = config_.direction *
        limit(config_.kp * error() + config_.ki * integral_ + config_.kd * rate_, config_.maxCommand);
}
