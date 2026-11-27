# PythonBlockの実行先に「ブラウザ」を選び、Startで実行する例。
import numpy as np

@kernel
def saxpy(i: int, a: float, x: InF32, y: InF32, out: OutF32) -> None:
    out[i] = a * x[i] + y[i]

n = 1000
x = np.zeros(n, dtype=np.float32)
y = np.zeros(n, dtype=np.float32)
out = np.zeros(n, dtype=np.float32)
i = 0
while i < n:
    x[i] = i
    y[i] = 1.0
    i += 1

launch(saxpy, n, 2.0, x, y, out)
first = out[0]
last = out[n - 1]
