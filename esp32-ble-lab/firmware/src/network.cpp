#include "network.h"
#include "camera.h"
#include "config.h"
#include <WiFi.h>
#include <Preferences.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <WebSocketsServer.h>
#include <esp_http_server.h>
#include <mbedtls/md.h>
#include <atomic>

namespace {
constexpr char CONFIG_UUID[] = "f3641404-00b0-4240-ba50-05ca45bf8abc";
constexpr char RESULT_UUID[] = "f3641405-00b0-4240-ba50-05ca45bf8abc";
struct Packet { uint8_t data[20]; uint8_t length; uint32_t generation; };
struct ConfigRequest { char text[384]; };
QueueHandle_t configQueue, outputQueue;
SemaphoreHandle_t stateLock;
NetworkCommand commandCallback;
NetworkSession sessionCallback;
void (*restartCallback)();
WebSocketsServer sockets(81);
httpd_handle_t httpServer = nullptr, cameraServer = nullptr;
std::atomic<bool> active{false}, ready{false}, shutdownBLE{false}, bleStopped{false};
std::atomic<uint32_t> generation{0};
String deviceId, hostname, deviceKey, wifiState = "idle", wifiError;
String pendingSSID, pendingPassword, savedSSID, savedPassword;
String challenge, controlSession;
int owner = -1; // -1: HTTP controller, nonnegative: WebSocket controller.
uint32_t counterHigh = 0, scanStarted = 0, wifiStarted = 0;
uint32_t outputCounter = 0;
uint64_t counterWindow = 0;
bool trying = false, persistPending = false, scanRunning = false, services = false;
uint32_t pairingCode;
uint8_t lastIMU[20]{};
bool haveIMU = false;
String controlOrigin;
String randomHex(size_t bytes) {
    const char hex[] = "0123456789abcdef";
    String result; result.reserve(bytes * 2);
    for (size_t i = 0; i < bytes; ++i) { uint8_t b = esp_random(); result += hex[b >> 4]; result += hex[b & 15]; }
    return result;
}
String hmac(const String &message) {
    uint8_t digest[32];
    mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
        reinterpret_cast<const uint8_t *>(deviceKey.c_str()), deviceKey.length(),
        reinterpret_cast<const uint8_t *>(message.c_str()), message.length(), digest);
    const char hex[] = "0123456789abcdef"; String result;
    for (uint8_t b : digest) { result += hex[b >> 4]; result += hex[b & 15]; }
    return result;
}
bool equalMAC(const String &a, const String &b) {
    if (a.length() != 64 || b.length() != 64) return false;
    uint8_t difference = 0; for (size_t i = 0; i < 64; ++i) difference |= a[i] ^ b[i];
    return difference == 0;
}
String packetHex(const uint8_t *data, size_t length) {
    const char hex[] = "0123456789abcdef"; String result;
    for (size_t i = 0; i < length; ++i) { result += hex[data[i] >> 4]; result += hex[data[i] & 15]; }
    return result;
}
bool unhex(const String &value, uint8_t *data, size_t length) {
    if (value.length() != length * 2) return false;
    for (size_t i = 0; i < length; ++i) {
        char pair[] = { value[i * 2], value[i * 2 + 1], 0 }; char *end;
        unsigned long v = strtoul(pair, &end, 16); if (*end) return false; data[i] = v;
    }
    return true;
}
bool allowedOrigin(const String &origin) {
    return origin.startsWith("https://") || origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:");
}
void metadata(JsonObject out, bool secret = false) {
    out["id"] = deviceId; out["name"] = DEVICE_NAME; out["host"] = hostname + ".local";
    out["ip"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("");
    out["port"] = 80; out["wsPort"] = 81; out["cameraPort"] = 82;
    out["camera"] = cameraAvailable(); out["state"] = wifiState; out["error"] = wifiError;
    if (secret) out["key"] = deviceKey;
}
String jsonReply(const String &operation, int page = 0) {
    StaticJsonDocument<768> doc;
    if (operation != "list") metadata(doc.to<JsonObject>(), operation == "info");
    if (operation == "list") {
        auto list = doc.createNestedArray("networks");
        int count = min(int(WiFi.scanComplete()), 128); doc["pages"] = count > 0 ? (count + 1) / 2 : 0;
        for (int i = page * 2; i < count && i < page * 2 + 2; ++i) {
            auto item = list.createNestedObject(); item["ssid"] = WiFi.SSID(i);
            item["rssi"] = WiFi.RSSI(i); item["open"] = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
        }
    }
    String result; serializeJson(doc, result);
    if (result.length() > 512) return "{\"error\":\"Response too large\"}";
    return result;
}
class Configuration : public NimBLECharacteristicCallbacks {
    String input, reply = "{\"state\":\"idle\"}";
    void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &peer) override {
        if (!peer.isEncrypted() || !peer.isAuthenticated()) return;
        auto value = c->getValue(); if (value.size() < 1) return;
        if (uint8_t(value[0]) == 0) input = "";
        if (value.size() > 1 && input.length() + value.size() - 1 < 384)
            for (size_t i = 1; i < value.size(); ++i) input += char(value[i]);
        else if (value.size() > 1) { input = ""; reply = "{\"error\":\"Request too large\"}"; return; }
        if (uint8_t(value[0]) != 2) return;
        StaticJsonDocument<512> doc;
        if (deserializeJson(doc, input)) { reply = "{\"error\":\"Invalid request\"}"; input = ""; return; }
        String op = doc["op"] | "";
        if (op == "info" || op == "list") {
            xSemaphoreTake(stateLock, portMAX_DELAY);
            reply = jsonReply(op, constrain(doc["page"] | 0, 0, 64));
            xSemaphoreGive(stateLock);
        } else if (op == "scan" || op == "configure" || op == "forget") {
            ConfigRequest request{}; input.toCharArray(request.text, sizeof request.text);
            reply = xQueueSend(configQueue, &request, 0) == pdTRUE ? "{\"accepted\":true}" : "{\"error\":\"Busy\"}";
        } else reply = "{\"error\":\"Unknown operation\"}";
        input = "";
    }
    void onRead(NimBLECharacteristic *c, NimBLEConnInfo &peer) override {
        if (peer.isEncrypted() && peer.isAuthenticated()) c->setValue(reply.c_str());
        else c->setValue("{}");
    }
public:
    void reset() { input = ""; reply = "{\"state\":\"idle\"}"; }
} configuration;

String header(httpd_req_t *req, const char *name) {
    size_t length = httpd_req_get_hdr_value_len(req, name);
    if (!length || length > 256) return "";
    char buffer[257]; httpd_req_get_hdr_value_str(req, name, buffer, sizeof buffer); return String(buffer);
}
// ESP-IDF borrows header value pointers. Keep this object alive until the response is sent.
class CorsHeaders {
    const String origin;
public:
    explicit CorsHeaders(httpd_req_t *req) : origin(header(req, "Origin")) {
        if (allowedOrigin(origin)) httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", origin.c_str());
        httpd_resp_set_hdr(req, "Vary", "Origin");
        httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type, X-Uroa-Session, X-Uroa-Counter, X-Uroa-Mac");
        httpd_resp_set_hdr(req, "Access-Control-Allow-Private-Network", "true");
        httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    }
};
esp_err_t respond(httpd_req_t *req, const String &body) {
    const CorsHeaders headers(req); httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, body.c_str(), body.length());
}
bool body(httpd_req_t *req, String &text) {
    if (req->content_len <= 0 || req->content_len >= 512) return false;
    char buffer[512]; int received = 0;
    while (received < req->content_len) {
        int n = httpd_req_recv(req, buffer + received, req->content_len - received);
        if (n <= 0) return false; received += n;
    }
    buffer[received] = 0; text = buffer; return true;
}
bool acceptCounter(uint32_t value) {
    if (!value) return false;
    if (value > counterHigh) {
        uint32_t shift = value - counterHigh;
        counterWindow = shift >= 64 ? 1 : (counterWindow << shift) | 1; counterHigh = value; return true;
    }
    uint32_t offset = counterHigh - value;
    if (offset >= 64 || (counterWindow & (uint64_t(1) << offset))) return false;
    counterWindow |= uint64_t(1) << offset; return true;
}
bool authorize(const String &sid, uint32_t count, const String &path, const String &payload, const String &mac) {
    if (!active || !ready || sid != controlSession) return false;
    if (!equalMAC(hmac(sid + "|" + String(count) + "|" + path + "|" + payload), mac)) return false;
    return acceptCounter(count);
}
bool authorizeHTTP(httpd_req_t *req, const String &payload = "") {
    xSemaphoreTake(stateLock, portMAX_DELAY);
    bool ok = authorize(header(req, "X-Uroa-Session"), header(req, "X-Uroa-Counter").toInt(),
        req->uri, payload, header(req, "X-Uroa-Mac"));
    xSemaphoreGive(stateLock);
    if (!ok) { const CorsHeaders headers(req); httpd_resp_send_err(req, HTTPD_401_UNAUTHORIZED, "Authentication required"); }
    return ok;
}
bool claim(const String &nonce, const String &proof, const String &origin, int socketOwner) {
    if (active || !allowedOrigin(origin) || nonce != challenge || nonce.isEmpty() ||
        !equalMAC(hmac("claim|" + deviceId + "|" + nonce + "|" + origin), proof)) return false;
    controlSession = randomHex(16); counterHigh = 0; counterWindow = 0; controlOrigin = origin;
    owner = socketOwner; ready = false; haveIMU = false; outputCounter = 0;
    ++generation; active = true; sessionCallback(true, generation); return true;
}
String claimReply() {
    StaticJsonDocument<768> doc; metadata(doc.to<JsonObject>());
    doc["session"] = controlSession;
    doc["proof"] = hmac("ready|" + deviceId + "|" + challenge + "|" + controlSession + "|" + hostname + ".local|" + WiFi.localIP().toString());
    String result; serializeJson(doc, result); return result;
}
esp_err_t options(httpd_req_t *req) { const CorsHeaders headers(req); return httpd_resp_send(req, "", 0); }
esp_err_t info(httpd_req_t *req) {
    xSemaphoreTake(stateLock, portMAX_DELAY);
    if (!active) challenge = randomHex(16);
    StaticJsonDocument<768> doc; metadata(doc.to<JsonObject>()); doc["challenge"] = challenge;
    String result; serializeJson(doc, result); xSemaphoreGive(stateLock); return respond(req, result);
}
esp_err_t claimHTTP(httpd_req_t *req) {
    String input; StaticJsonDocument<512> doc;
    if (!body(req, input) || deserializeJson(doc, input)) return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid request");
    xSemaphoreTake(stateLock, portMAX_DELAY);
    bool ok = claim(doc["challenge"] | "", doc["proof"] | "", header(req, "Origin"), -1);
    xSemaphoreGive(stateLock);
    if (!ok) { const CorsHeaders headers(req); return httpd_resp_send_err(req, HTTPD_403_FORBIDDEN, "Connection refused"); }
    for (int i = 0; i < 100 && active && !ready; ++i) vTaskDelay(pdMS_TO_TICKS(10));
    if (!ready) { httpd_resp_set_status(req, "503 Service Unavailable"); return httpd_resp_send(req, "Not ready", HTTPD_RESP_USE_STRLEN); }
    xSemaphoreTake(stateLock, portMAX_DELAY); String reply = claimReply(); xSemaphoreGive(stateLock);
    shutdownBLE = true; return respond(req, reply);
}
esp_err_t commandHTTP(httpd_req_t *req) {
    String payload; if (!body(req, payload)) return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid request");
    if (!authorizeHTTP(req, payload)) return ESP_OK;
    uint8_t data[10]; if (!unhex(payload, data, sizeof data)) return httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid command");
    commandCallback(data, sizeof data, generation); return respond(req, "{\"accepted\":true}");
}
esp_err_t eventsHTTP(httpd_req_t *req) {
    if (!authorizeHTTP(req)) return ESP_OK;
    StaticJsonDocument<2048> doc; auto packets = doc.createNestedArray("packets");
    Packet p; for (int n = 0; n < 16 && xQueueReceive(outputQueue, &p, 0) == pdTRUE; ++n)
        if (p.generation == generation) packets.add(packetHex(p.data, p.length));
    xSemaphoreTake(stateLock, portMAX_DELAY);
    if (haveIMU) { packets.add(packetHex(lastIMU, 20)); haveIMU = false; }
    doc["session"] = controlSession;
    String data; serializeJson(packets, data);
    String requestCount = header(req, "X-Uroa-Counter"); doc["counter"] = requestCount;
    doc["proof"] = hmac(controlSession + "|events|" + requestCount + "|" + data);
    xSemaphoreGive(stateLock);
    String result; serializeJson(doc, result); return respond(req, result);
}
esp_err_t releaseHTTP(httpd_req_t *req) {
    if (!authorizeHTTP(req)) return ESP_OK;
    networkStopControl(); return respond(req, "{\"released\":true}");
}
esp_err_t imageHTTP(httpd_req_t *req) {
    if (!authorizeHTTP(req)) return ESP_OK;
    const CorsHeaders headers(req); cameraServe(req); return ESP_OK;
}
void registerRoute(httpd_handle_t server, const char *uri, httpd_method_t method, esp_err_t (*handler)(httpd_req_t *)) {
    httpd_uri_t route{}; route.uri = uri; route.method = method; route.handler = handler;
    httpd_register_uri_handler(server, &route);
}
void startServices() {
    if (services) return;
    cameraBegin();
    MDNS.begin(hostname.c_str()); MDNS.addService("http", "tcp", 80);
    httpd_config_t config = HTTPD_DEFAULT_CONFIG(); config.server_port = 80; config.ctrl_port = 32768;
    config.stack_size = 8192; config.max_uri_handlers = 16; config.recv_wait_timeout = 2; config.send_wait_timeout = 2;
    if (httpd_start(&httpServer, &config) != ESP_OK) { wifiError = "HTTP start failed"; return; }
    registerRoute(httpServer, "/info", HTTP_GET, info);
    registerRoute(httpServer, "/claim", HTTP_POST, claimHTTP);
    registerRoute(httpServer, "/command", HTTP_POST, commandHTTP);
    registerRoute(httpServer, "/events", HTTP_GET, eventsHTTP);
    registerRoute(httpServer, "/release", HTTP_POST, releaseHTTP);
    for (const char *path : {"/info", "/claim", "/command", "/events", "/release"}) registerRoute(httpServer, path, HTTP_OPTIONS, options);
    config.server_port = 82; config.ctrl_port = 32769; config.max_uri_handlers = 4;
    if (httpd_start(&cameraServer, &config) == ESP_OK) {
        registerRoute(cameraServer, "/capture", HTTP_GET, imageHTTP); registerRoute(cameraServer, "/capture", HTTP_OPTIONS, options);
    }
    sockets.begin(); services = true;
}
void socketEvent(uint8_t number, WStype_t type, uint8_t *payload, size_t length) {
    if (type == WStype_DISCONNECTED) { if (active && owner == number) networkStopControl(); return; }
    if (type == WStype_CONNECTED) {
        xSemaphoreTake(stateLock, portMAX_DELAY);
        StaticJsonDocument<768> doc; metadata(doc.to<JsonObject>());
        if (!active) challenge = randomHex(16); doc["challenge"] = challenge;
        String result; serializeJson(doc, result); xSemaphoreGive(stateLock);
        sockets.sendTXT(number, result); return;
    }
    if (type != WStype_TEXT || length >= 512) return;
    StaticJsonDocument<768> doc; if (deserializeJson(doc, payload, length)) return;
    String op = doc["op"] | "";
    if (op == "claim") {
        xSemaphoreTake(stateLock, portMAX_DELAY);
        bool ok = claim(doc["challenge"] | "", doc["proof"] | "", doc["origin"] | "", number);
        xSemaphoreGive(stateLock);
        if (!ok) sockets.disconnect(number);
        return;
    }
    if (!active || !ready || owner != number) return;
    String data = doc["data"] | "";
    xSemaphoreTake(stateLock, portMAX_DELAY);
    bool ok = authorize(doc["session"] | "", doc["counter"] | uint32_t(0), "/command", data, doc["mac"] | "");
    xSemaphoreGive(stateLock);
    uint8_t bytes[10]; if (ok && unhex(data, bytes, sizeof bytes)) commandCallback(bytes, 10, generation);
    else sockets.disconnect(number);
}
void worker(void *) {
    sockets.onEvent(socketEvent);
    uint32_t lastSocketReady = 0;
    for (;;) {
        ConfigRequest req;
        if (xQueueReceive(configQueue, &req, 0) == pdTRUE) {
            StaticJsonDocument<512> doc;
            if (!deserializeJson(doc, req.text)) {
                String op = doc["op"] | "";
                xSemaphoreTake(stateLock, portMAX_DELAY);
                if (!active) {
                    wifiError = "";
                    if (op == "scan" && !trying && !scanRunning) {
                        WiFi.scanDelete(); WiFi.scanNetworks(true, true); scanRunning = true;
                        wifiState = "scanning"; scanStarted = millis();
                    } else if (op == "configure" && !scanRunning) {
                        String ssid = doc["ssid"] | "", password = doc["password"] | "";
                        if (!ssid.length() || ssid.length() > 32 || (password.length() && password.length() < 8) || password.length() > 63) wifiError = "Invalid Wi-Fi settings";
                        else {
                            networkStopControl(); WiFi.disconnect(false, false); WiFi.begin(ssid.c_str(), password.c_str());
                            pendingSSID = ssid; pendingPassword = password; trying = persistPending = true;
                            wifiStarted = millis(); wifiState = "connecting";
                        }
                        password = "";
                    } else if (op == "forget") {
                        Preferences prefs; if (prefs.begin("uroa-net", false)) { prefs.remove("wifi"); prefs.end(); }
                        savedSSID = savedPassword = pendingSSID = pendingPassword = "";
                        WiFi.disconnect(false, true); trying = persistPending = false; wifiState = "idle";
                    }
                } else wifiError = "Disconnect Wi-Fi control before setup";
                xSemaphoreGive(stateLock);
            }
            memset(&req, 0, sizeof req);
        }
        if (scanRunning) {
            int result = WiFi.scanComplete();
            if (result != WIFI_SCAN_RUNNING || millis() - scanStarted > 15000) {
                xSemaphoreTake(stateLock, portMAX_DELAY); scanRunning = false;
                wifiState = WiFi.status() == WL_CONNECTED ? "connected" : "idle";
                if (result < 0) wifiError = "Wi-Fi scan failed";
                xSemaphoreGive(stateLock);
            }
        }
        if (trying && WiFi.status() == WL_CONNECTED) {
            startServices();
            xSemaphoreTake(stateLock, portMAX_DELAY);
            wifiState = services ? "connected" : "error";
            if (persistPending && services) {
                // One JSON entry makes SSID/password replacement atomic within NVS.
                StaticJsonDocument<192> doc; doc["ssid"] = pendingSSID; doc["password"] = pendingPassword;
                String value; serializeJson(doc, value); Preferences prefs;
                bool stored = prefs.begin("uroa-net", false) && prefs.putString("wifi", value) > 0; prefs.end();
                if (stored) { savedSSID = pendingSSID; savedPassword = pendingPassword; }
                else wifiError = "Wi-Fi connected; NVS save failed";
                value = "";
            }
            trying = persistPending = false; pendingPassword = "";
            xSemaphoreGive(stateLock);
        }
        if (trying && millis() - wifiStarted > 20000) {
            xSemaphoreTake(stateLock, portMAX_DELAY); trying = persistPending = false; pendingPassword = "";
            wifiState = "error"; wifiError = "Wi-Fi connection failed; check SSID/password"; xSemaphoreGive(stateLock);
        }
        if (services && WiFi.status() != WL_CONNECTED && !trying && !scanRunning) {
            networkStopControl();
            xSemaphoreTake(stateLock, portMAX_DELAY); wifiState = "error"; wifiError = "Wi-Fi disconnected"; xSemaphoreGive(stateLock);
        }
        if (services) sockets.loop();
        if (active && ready && owner >= 0) {
            if (lastSocketReady != generation) {
                xSemaphoreTake(stateLock, portMAX_DELAY); String reply = claimReply(); xSemaphoreGive(stateLock);
                sockets.sendTXT(owner, reply); lastSocketReady = generation; shutdownBLE = true;
            }
            Packet p;
            for (int n = 0; n < 16 && xQueueReceive(outputQueue, &p, 0) == pdTRUE; ++n) if (p.generation == generation) {
                xSemaphoreTake(stateLock, portMAX_DELAY);
                StaticJsonDocument<384> doc; String data = packetHex(p.data, p.length);
                uint32_t count = ++outputCounter;
                doc["data"] = data; doc["counter"] = count;
                doc["proof"] = hmac(controlSession + "|packet|" + String(count) + "|" + data);
                String result; serializeJson(doc, result); xSemaphoreGive(stateLock); sockets.sendTXT(owner, result);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(5));
    }
}
} // namespace

void networkBegin(NetworkCommand command, NetworkSession session, void (*restartBLE)()) {
    commandCallback = command; sessionCallback = session; restartCallback = restartBLE;
    stateLock = xSemaphoreCreateMutex(); configQueue = xQueueCreate(4, sizeof(ConfigRequest)); outputQueue = xQueueCreate(32, sizeof(Packet));
    if (!stateLock || !configQueue || !outputQueue) { Serial.println("Network allocation failed"); while (true) delay(1000); }
    Preferences prefs;
    if (!prefs.begin("uroa-net", false)) { Serial.println("Network NVS unavailable"); while (true) delay(1000); }
    deviceId = prefs.getString("id", ""); if (deviceId.isEmpty()) { deviceId = "uroa-" + randomHex(6); prefs.putString("id", deviceId); }
    deviceKey = prefs.getString("key", ""); if (deviceKey.length() != 64) { deviceKey = randomHex(32); prefs.putString("key", deviceKey); }
    hostname = deviceId;
    StaticJsonDocument<192> doc; String config = prefs.getString("wifi", "");
    if (!deserializeJson(doc, config)) { savedSSID = doc["ssid"] | ""; savedPassword = doc["password"] | ""; }
    config = ""; prefs.end(); pairingCode = esp_random() % 1000000;
    WiFi.persistent(false); WiFi.mode(WIFI_STA);
    if (!savedSSID.isEmpty()) { WiFi.begin(savedSSID.c_str(), savedPassword.c_str()); trying = true; wifiStarted = millis(); wifiState = "connecting"; }
    xTaskCreate(worker, "uroa-network", 12288, nullptr, 1, nullptr);
}
void networkRegisterBLE(NimBLEService *service) {
    configuration.reset();
    auto config = service->createCharacteristic(CONFIG_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_ENC | NIMBLE_PROPERTY::WRITE_AUTHEN, 384);
    auto result = service->createCharacteristic(RESULT_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::READ_ENC | NIMBLE_PROPERTY::READ_AUTHEN, 512);
    config->setCallbacks(&configuration); result->setCallbacks(&configuration);
}
bool networkConnected() { return active.load(); }
uint32_t networkGeneration() { return generation.load(); }
uint32_t networkPairingPasskey() { return pairingCode; }
bool networkBLEStopping() { return shutdownBLE || bleStopped; }
void networkStopControl() {
    if (active.exchange(false)) { ready = false; ++generation; sessionCallback(false, generation); }
}
void networkTick() {
    static uint32_t seen = 0, announced = 0, shutdownAt = 0;
    if (active && !ready) {
        if (seen == generation) ready = true;
        else seen = generation;
    }
    if (shutdownBLE && !bleStopped) {
        if (!shutdownAt) shutdownAt = millis();
        if (millis() - shutdownAt > 500) { NimBLEDevice::deinit(true); bleStopped = true; shutdownBLE = false; shutdownAt = 0; }
    }
    if (!active && bleStopped) { shutdownBLE = false; restartCallback(); bleStopped = false; }
    if (active) announced = generation;
    else if (announced) { announced = 0; shutdownBLE = false; shutdownAt = 0; }
}
void networkPublish(const uint8_t *data, size_t length) {
    if (!active || !ready || length > 20) return;
    if (length == 20) {
        xSemaphoreTake(stateLock, portMAX_DELAY); memcpy(lastIMU, data, 20); haveIMU = true; xSemaphoreGive(stateLock);
        if (owner < 0) return;
    }
    Packet packet{}; memcpy(packet.data, data, length); packet.length = length; packet.generation = generation;
    if (xQueueSend(outputQueue, &packet, 0) != pdTRUE) networkStopControl();
}
