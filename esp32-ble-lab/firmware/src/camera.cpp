#include "camera.h"
#include <esp_http_server.h>
#include <atomic>
#if defined(ARDUINO_XIAO_ESP32S3)
#include <esp_camera.h>
#endif

static std::atomic<bool> ready{false};
bool cameraAvailable() { return ready; }
bool cameraBegin()
{
#if defined(ARDUINO_XIAO_ESP32S3)
    if (!psramFound()) return false;
    camera_config_t c{};
    c.ledc_channel = LEDC_CHANNEL_0; c.ledc_timer = LEDC_TIMER_0;
    c.pin_d0 = 15; c.pin_d1 = 17; c.pin_d2 = 18; c.pin_d3 = 16;
    c.pin_d4 = 14; c.pin_d5 = 12; c.pin_d6 = 11; c.pin_d7 = 48;
    c.pin_xclk = 10; c.pin_pclk = 13; c.pin_vsync = 38; c.pin_href = 47;
    c.pin_sccb_sda = 40; c.pin_sccb_scl = 39;
    c.pin_pwdn = -1; c.pin_reset = -1;
    c.xclk_freq_hz = 20000000; c.pixel_format = PIXFORMAT_JPEG;
    c.frame_size = FRAMESIZE_QVGA; c.jpeg_quality = 16; c.fb_count = 1;
    c.fb_location = CAMERA_FB_IN_PSRAM; c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
    ready = esp_camera_init(&c) == ESP_OK;
#endif
    return ready;
}
void cameraServe(void *request)
{
    auto req = static_cast<httpd_req_t *>(request);
#if defined(ARDUINO_XIAO_ESP32S3)
    if (ready) {
        camera_fb_t *fb = esp_camera_fb_get();
        if (fb) {
            httpd_resp_set_type(req, "image/jpeg");
            httpd_resp_send(req, reinterpret_cast<const char *>(fb->buf), fb->len);
            esp_camera_fb_return(fb);
            return;
        }
    }
#endif
    httpd_resp_set_status(req, "503 Service Unavailable");
    httpd_resp_send(req, "Camera unavailable", HTTPD_RESP_USE_STRLEN);
}
