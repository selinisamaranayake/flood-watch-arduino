var sensorChart = null;
var chartCanvas = document.getElementById("sensorChart");
var statusMessage = document.getElementById("statusMessage");

document.getElementById("fileInput").addEventListener("change", function(event) {
  var file = event.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    setStatus("Please upload an .xlsx file.", true);
    return;
  }

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var workbook = XLSX.read(e.target.result, { type: "array" });
      var sheet = workbook.Sheets[workbook.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });

      if (!rows || rows.length === 0) {
        setStatus("The Excel sheet is empty.", true);
        return;
      }

      var firstRow = rows[0];
      var hasHeaders = (typeof firstRow[0] === "string") && (typeof firstRow[1] === "string");
      var dataRows = hasHeaders ? rows.slice(1) : rows;

      var timePoints = [];
      var values = [];

      for (var i = 0; i < dataRows.length; i++) {
        var t = dataRows[i][0];
        var v = dataRows[i][1];
        if (t == null || t === "" || v == null || v === "") continue;
        var num = Number(v);
        if (isNaN(num)) {
          setStatus("Column B contains non-numeric values.", true);
          return;
        }
        timePoints.push(String(t));
        values.push(num);
      }

      if (timePoints.length === 0) {
        setStatus("No valid data found in columns A and B.", true);
        return;
      }

      renderChart(timePoints, values);
      setStatus("Loaded " + timePoints.length + " data points from " + file.name + ".");

    } catch (err) {
      setStatus("Failed to process file.", true);
    }
  };
  reader.readAsArrayBuffer(file);
});

function renderChart(labels, data) {
  if (sensorChart) { sensorChart.destroy(); sensorChart = null; }

  sensorChart = new Chart(chartCanvas, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: "Sensor Reading",
        data: data,
        borderColor: "#2563eb",
        backgroundColor: "rgba(37, 99, 235, 0.1)",
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.2,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { title: { display: true, text: "Time" } },
        y: { title: { display: true, text: "Value" }, beginAtZero: false }
      }
    }
  });
}

function setStatus(msg, isError) {
  statusMessage.textContent = msg;
  if (isError) { statusMessage.classList.add("error"); }
  else { statusMessage.classList.remove("error"); }
}
