/** Live Arduino serial chart — edit BAUD_RATE if your sketch differs. */
var BAUD_RATE = 9600;
var MAX_POINTS = 150;
var THRESHOLD_VALUE = 16;

var sensorChart = null;
var chartCanvas = null;

var chartLabels = [];
var chartValues = [];
var sampleSeq = 0;
var totalSamples = 0;
var invalidLines = 0;

var keepReading = false;
var portRef = null;
var readerRef = null;
var readableClosedRef = null;

var elConnStatus = null;
var elLatest = null;
var elSampleCount = null;
var elInvalidCount = null;
var elErrorLine = null;
var elUnsupported = null;
var btnConnect = null;
var btnDisconnect = null;
var btnClear = null;

/** Set true after DOM init if Web Serial API exists (Chrome / Edge). */
var serialSupported = false;

document.addEventListener("DOMContentLoaded", function () {
  chartCanvas = document.getElementById("sensorChart");
  elConnStatus = document.getElementById("serialConnStatus");
  elLatest = document.getElementById("serialLatestValue");
  elSampleCount = document.getElementById("serialSampleCount");
  elInvalidCount = document.getElementById("serialInvalidCount");
  elErrorLine = document.getElementById("serialErrorLine");
  elUnsupported = document.getElementById("serialUnsupported");
  btnConnect = document.getElementById("btnSerialConnect");
  btnDisconnect = document.getElementById("btnSerialDisconnect");
  btnClear = document.getElementById("btnSerialClear");

  if (!chartCanvas || !elConnStatus || !btnConnect || !btnDisconnect || !btnClear) {
    return;
  }

  initChart();

  serialSupported = typeof navigator !== "undefined" && "serial" in navigator;
  if (!serialSupported && elUnsupported) {
    elUnsupported.classList.remove("hidden");
  }
  if (!serialSupported) {
    btnConnect.disabled = true;
    setConnStatus("Unavailable");
  }

  btnConnect.addEventListener("click", function () {
    connectToArduino().catch(function (err) {
      showError("Unexpected error: " + (err && err.message ? err.message : String(err)));
    });
  });
  btnDisconnect.addEventListener("click", function () {
    disconnectSerial().catch(function () {
      /* ignore */
    });
  });
  btnClear.addEventListener("click", function () {
    clearChartData();
  });

  if (serialSupported && navigator.serial && navigator.serial.addEventListener) {
    navigator.serial.addEventListener("disconnect", function (event) {
      if (portRef && event.target === portRef) {
        showError("Serial port disconnected.");
        disconnectSerial();
      }
    });
  }
});

function createLineSplitter() {
  var buffer = "";
  return new TransformStream({
    transform: function (chunk, controller) {
      buffer += chunk;
      var lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (var i = 0; i < lines.length; i++) {
        controller.enqueue(lines[i]);
      }
    },
    flush: function (controller) {
      if (buffer) {
        controller.enqueue(buffer);
      }
    },
  });
}

function initChart() {
  if (!chartCanvas || typeof Chart === "undefined") {
    return;
  }
  if (sensorChart) {
    sensorChart.destroy();
    sensorChart = null;
  }
  sensorChart = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels: ["0", "1"],
      datasets: [
        {
          label: "Sensor value",
          data: chartValues,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.12)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.2,
          fill: true,
          spanGaps: false,
        },
        {
          label: "Threshold (16)",
          data: [THRESHOLD_VALUE, THRESHOLD_VALUE],
          borderColor: "#d92d20",
          borderWidth: 2,
          borderDash: [6, 6],
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          title: { display: true, text: "Sample #" },
        },
        y: {
          title: { display: true, text: "Value" },
          beginAtZero: false,
        },
      },
    },
  });
}

function setConnStatus(text) {
  if (elConnStatus) {
    elConnStatus.textContent = text;
  }
}

function setButtonsConnected(connected) {
  if (btnConnect) {
    btnConnect.disabled = !serialSupported || connected;
  }
  if (btnDisconnect) {
    btnDisconnect.disabled = !connected;
  }
}

function showError(msg) {
  if (!elErrorLine) {
    return;
  }
  elErrorLine.textContent = msg;
  elErrorLine.classList.remove("hidden");
}

function clearError() {
  if (!elErrorLine) {
    return;
  }
  elErrorLine.textContent = "";
  elErrorLine.classList.add("hidden");
}

function appendPoint(value) {
  chartLabels.push(String(sampleSeq++));
  chartValues.push(value);
  while (chartLabels.length > MAX_POINTS) {
    chartLabels.shift();
    chartValues.shift();
  }
  if (sensorChart) {
    sensorChart.data.labels = chartLabels.length ? chartLabels : ["0", "1"];
    sensorChart.data.datasets[0].data = chartValues;
    sensorChart.data.datasets[1].data = chartLabels.length
      ? chartLabels.map(function () {
          return THRESHOLD_VALUE;
        })
      : [THRESHOLD_VALUE, THRESHOLD_VALUE];
    sensorChart.update("none");
  }
}

function clearChartData() {
  chartLabels.length = 0;
  chartValues.length = 0;
  sampleSeq = 0;
  totalSamples = 0;
  invalidLines = 0;
  if (elLatest) {
    elLatest.textContent = "—";
  }
  if (elSampleCount) {
    elSampleCount.textContent = "0";
  }
  if (elInvalidCount) {
    elInvalidCount.textContent = "0";
  }
  if (sensorChart) {
    sensorChart.data.labels = chartLabels;
    sensorChart.data.datasets[0].data = chartValues;
    sensorChart.data.datasets[1].data = chartLabels.map(function () {
      return THRESHOLD_VALUE;
    });
    sensorChart.update("none");
  }
}

async function safeDisconnect() {
  keepReading = false;

  if (readerRef) {
    try {
      await readerRef.cancel();
    } catch (e) {
      /* ignore */
    }
    try {
      readerRef.releaseLock();
    } catch (e) {
      /* ignore */
    }
    readerRef = null;
  }

  if (readableClosedRef) {
    try {
      await readableClosedRef;
    } catch (e) {
      /* ignore */
    }
    readableClosedRef = null;
  }

  if (portRef) {
    try {
      await portRef.close();
    } catch (e) {
      /* ignore */
    }
    portRef = null;
  }

  setConnStatus("Disconnected");
  setButtonsConnected(false);
}

async function disconnectSerial() {
  keepReading = false;
  await safeDisconnect();
}

async function connectToArduino() {
  clearError();

  if (!("serial" in navigator)) {
    showError("Web Serial is not supported in this browser.");
    return;
  }

  var port;
  try {
    port = await navigator.serial.requestPort();
  } catch (err) {
    if (err && err.name === "NotFoundError") {
      showError("Port selection was cancelled.");
      return;
    }
    showError("Could not select serial port: " + (err && err.message ? err.message : String(err)));
    return;
  }

  try {
    await port.open({ baudRate: BAUD_RATE });
  } catch (err) {
    showError("Could not open serial port: " + (err && err.message ? err.message : String(err)));
    return;
  }

  portRef = port;
  keepReading = true;
  setConnStatus("Connected");
  setButtonsConnected(true);

  try {
    var decoder = new TextDecoderStream();
    readableClosedRef = port.readable.pipeTo(decoder.writable);
    var lineStream = decoder.readable.pipeThrough(createLineSplitter());
    var reader = lineStream.getReader();
    readerRef = reader;
  } catch (err) {
    showError("Could not open serial stream: " + (err && err.message ? err.message : String(err)));
    await safeDisconnect();
    return;
  }

  try {
    while (keepReading) {
      var result = await reader.read();
      if (result.done) {
        break;
      }
      var line = (result.value || "").trim();
      if (!line) {
        continue;
      }
      var parsed = Number(line);
      if (!Number.isFinite(parsed)) {
        invalidLines += 1;
        if (elInvalidCount) {
          elInvalidCount.textContent = String(invalidLines);
        }
        continue;
      }

      totalSamples += 1;
      if (elSampleCount) {
        elSampleCount.textContent = String(totalSamples);
      }
      if (elLatest) {
        elLatest.textContent = String(parsed);
      }
      setConnStatus("Reading data");
      appendPoint(parsed);
    }
  } catch (err) {
    if (keepReading) {
      showError("Serial read error: " + (err && err.message ? err.message : String(err)));
    }
  } finally {
    await safeDisconnect();
  }
}
