#pragma once
#include <Arduino.h>
#include <NimBLEDevice.h>

// These callbacks only enqueue commands / request a stop; network tasks never use I2C.
using NetworkCommand = void (*)(const uint8_t *, size_t, uint32_t);
using NetworkSession = void (*)(bool, uint32_t);
void networkBegin(NetworkCommand command, NetworkSession session, void (*restartBLE)());
void networkRegisterBLE(NimBLEService *service);
void networkTick();
void networkPublish(const uint8_t *data, size_t length);
bool networkConnected();
uint32_t networkGeneration();
uint32_t networkPairingPasskey();
void networkStopControl();
bool networkBLEStopping();
