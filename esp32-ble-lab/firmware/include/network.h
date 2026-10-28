#pragma once
#include <uroa_wifi.h>

// この教材で使うネットワーク。通信の実装はesp32/lib/wifiへ置く。
extern uroa::WifiNetwork network;
void beginNetwork(const uroa::WifiNetwork::Callbacks &callbacks);
