#pragma once
#include <Arduino.h>
bool cameraBegin();
bool cameraAvailable();
void cameraServe(void *request);
