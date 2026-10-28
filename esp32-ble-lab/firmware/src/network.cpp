#include "network.h"
#include "camera.h"
#include "config.h"

uroa::WifiNetwork network;

void beginNetwork(const uroa::WifiNetwork::Callbacks &callbacks) {
    uroa::WifiNetwork::Config config;
    config.name = DEVICE_NAME; config.connectionKey = TEACHING_CONNECTION_KEY;
    config.nvsNamespace = "uroa-net";
    auto hooks = callbacks;
    // XIAOの画像取得は教材側の既存実装へ委譲する。Wi-Fiライブラリーは基板に依存しない。
    hooks.cameraBegin = [] { cameraBegin(); };
    hooks.cameraAvailable = [] { return cameraAvailable(); };
    hooks.cameraServe = [](httpd_req_t *request) { cameraServe(request); };
    network.begin(config, hooks);
}
