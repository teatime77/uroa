/**
 * @file hardware_config.h
 * @brief 倒立教材のピン、車輪、中立パルス、ゲインと通信設定を定義する。
 */
#pragma once
#include <stdint.h>

namespace hardware {
    constexpr int Sda = 8;
    constexpr int Scl = 9;
    constexpr uint8_t PcaAddress = 0x40;
    constexpr uint8_t LeftChannel = 0;
    constexpr uint8_t RightChannel = 1;
    constexpr float PwmHz = 50;
    /** @brief FS90Rの個体ごとに調整する中立パルス幅。単位はµs。 */
    constexpr uint16_t LeftNeutralUs = 1500;
    constexpr uint16_t RightNeutralUs = 1500;
    constexpr uint16_t PulseSpanUs = 500; ///< ±100%に対応する中立からのパルス変化量（µs）。
    /** @brief 左右の鏡像配置を想定し、同じ正の指令で車体が前進する向きにする。 */
    constexpr int LeftDirection = 1;
    constexpr int RightDirection = -1;
    constexpr int ControlDirection = 1; ///< 傾いた側へ車輪が進むよう、実車で確認する符号。
    constexpr float Kp = 3.0f; ///< 比例ゲイン（%/度）。
    constexpr float Ki = 0.0f; ///< 積分ゲイン（%/(度・秒)）。
    constexpr float Kd = 0.15f; ///< 微分ゲイン（%/(度/秒)）。
    constexpr float MaxCommand = 60.0f;
    constexpr float FallAngleDeg = 25.0f;
    constexpr uint32_t PeriodMs = 10;
    constexpr uint32_t HeartbeatMs = 5000;
    constexpr char DeviceName[] = "ESP32-Inverted-Pendulum";
    constexpr char ServiceUuid[] = "f3641400-00b0-4240-ba50-05ca45bf8abc";
    constexpr char CommandUuid[] = "f3641401-00b0-4240-ba50-05ca45bf8abc";
    constexpr char TelemetryUuid[] = "f3641402-00b0-4240-ba50-05ca45bf8abc";
    constexpr char StatusUuid[] = "f3641403-00b0-4240-ba50-05ca45bf8abc";
    static_assert(
        LeftChannel < 16 && RightChannel < 16 && LeftChannel != RightChannel, "Wheel channels must be distinct, 0..15");
    static_assert((LeftDirection == 1 || LeftDirection == -1) && (RightDirection == 1 || RightDirection == -1) &&
            (ControlDirection == 1 || ControlDirection == -1),
        "Directions must be +1 or -1");
    static_assert(LeftNeutralUs >= 700 + PulseSpanUs && LeftNeutralUs + PulseSpanUs <= 2300 &&
            RightNeutralUs >= 700 + PulseSpanUs && RightNeutralUs + PulseSpanUs <= 2300,
        "FS90R pulses must stay within 700..2300us");
    static_assert(
        MaxCommand > 0 && MaxCommand <= 100 && Kp >= 0 && Ki >= 0 && Kd >= 0, "Invalid controller limits/gains");
}
