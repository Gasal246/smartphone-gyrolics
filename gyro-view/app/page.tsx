import { TelemetryDashboard } from "@/components/TelemetryDashboard";

const liveDashboardScript = `
(function () {
  var pollCount = 0;
  var lastPacketId = "";
  var histories = {};
  var maxHistory = 96;
  var sensitivity = 1;

  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  function qLive(name) {
    return document.querySelectorAll('[data-live="' + name + '"]');
  }

  function setLive(name, value) {
    qLive(name).forEach(function (node) {
      node.textContent = String(value);
    });
  }

  function first(name) {
    return document.querySelector('[data-live="' + name + '"]');
  }

  function num(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback || 0;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function format(value, digits) {
    value = num(value, 0);
    if (Math.abs(value) >= 100) {
      return value.toFixed(1);
    }
    return value.toFixed(digits == null ? 3 : digits);
  }

  function axisSample(axis) {
    var x = num(axis && axis.x, 0);
    var y = num(axis && axis.y, 0);
    var z = num(axis && axis.z, 0);
    return { x: x, y: y, z: z, magnitude: Math.sqrt(x * x + y * y + z * z) };
  }

  function rotationSample(rotation) {
    var x = num(rotation && rotation.alpha, 0);
    var y = num(rotation && rotation.beta, 0);
    var z = num(rotation && rotation.gamma, 0);
    return { x: x, y: y, z: z, magnitude: Math.sqrt(x * x + y * y + z * z) };
  }

  function packetId(meta) {
    if (!meta) {
      return "";
    }
    return [meta.remote, meta.receivedPackets, meta.receivedAtServer].join("|");
  }

  function buildMeters(payload) {
    var telemetry = (payload && payload.telemetry) || {};
    var deviceMotion = (telemetry.deviceMotion && telemetry.deviceMotion.data) || {};

    return [
      {
        key: "gyroscope",
        range: 1,
        sample: axisSample(telemetry.gyroscope && telemetry.gyroscope.data),
        sequence: telemetry.gyroscope && telemetry.gyroscope.sequence
      },
      {
        key: "accelerometer",
        range: 2,
        sample: axisSample(telemetry.accelerometer && telemetry.accelerometer.data),
        sequence: telemetry.accelerometer && telemetry.accelerometer.sequence
      },
      {
        key: "magnetometer",
        range: 80,
        sample: axisSample(telemetry.magnetometer && telemetry.magnetometer.data),
        sequence: telemetry.magnetometer && telemetry.magnetometer.sequence
      },
      {
        key: "motion-acceleration",
        range: 6,
        sample: axisSample(deviceMotion.acceleration),
        sequence: telemetry.deviceMotion && telemetry.deviceMotion.sequence
      },
      {
        key: "gravity",
        range: 12,
        sample: axisSample(deviceMotion.accelerationIncludingGravity),
        sequence: telemetry.deviceMotion && telemetry.deviceMotion.sequence
      },
      {
        key: "rotation",
        range: 90,
        sample: rotationSample(deviceMotion.rotation),
        sequence: telemetry.deviceMotion && telemetry.deviceMotion.sequence
      },
      {
        key: "rotation-rate",
        range: 8,
        sample: rotationSample(deviceMotion.rotationRate),
        sequence: telemetry.deviceMotion && telemetry.deviceMotion.sequence
      }
    ];
  }

  function updateAxis(key, axis, value, range) {
    setLive("meter:" + key + ":" + axis, format(value, 3));
    var fill = first("meter:" + key + ":" + axis + ":fill");
    if (!fill) {
      return;
    }
    var percent = clamp(Math.abs(value) / range, 0, 1) * 50;
    fill.style.left = (value < 0 ? 50 - percent : 50) + "%";
    fill.style.width = percent + "%";
  }

  function updateSparkline(key, sample, range) {
    var values = histories[key] || [];
    values.push(sample);
    histories[key] = values.slice(-maxHistory);

    var points = histories[key].map(function (item, index) {
      var x = histories[key].length <= 1 ? 0 : (index / (histories[key].length - 1)) * 100;
      var y = 100 - clamp(item.magnitude / range, 0, 1) * 100;
      return x + "," + y;
    }).join(" ");

    qLive("meter:" + key + ":spark").forEach(function (node) {
      node.setAttribute("points", points || "0,100 100,100");
    });
  }

  function updateMeter(meter) {
    var range = meter.range / sensitivity;
    var sample = meter.sample;
    setLive("meter:" + meter.key + ":sequence", "#" + (meter.sequence || 0));
    setLive("meter:" + meter.key + ":magnitude", format(sample.magnitude, 3));
    updateAxis(meter.key, "x", sample.x, range);
    updateAxis(meter.key, "y", sample.y, range);
    updateAxis(meter.key, "z", sample.z, range);
    updateSparkline(meter.key, sample, range);

    qLive("meter:" + meter.key + ":gauge").forEach(function (node) {
      node.style.setProperty("--gauge", clamp(sample.magnitude / range, 0, 1) * 270 + "deg");
    });
  }

  function updatePhone(payload, meters) {
    var telemetry = (payload && payload.telemetry) || {};
    var deviceMotion = (telemetry.deviceMotion && telemetry.deviceMotion.data) || {};
    var rotation = deviceMotion.rotation || {};
    var gravity = (meters.find(function (m) { return m.key === "gravity"; }) || { sample: { x: 0, y: 0, z: 0 } }).sample;
    var rotateX = clamp(typeof rotation.beta === "number" ? rotation.beta : gravity.y * -9, -70, 70);
    var rotateY = clamp(typeof rotation.gamma === "number" ? rotation.gamma : gravity.x * 9, -70, 70);
    var rotateZ = clamp((typeof rotation.alpha === "number" ? rotation.alpha : 0) / 6, -35, 35);
    var model = first("phone-model");
    if (model) {
      model.style.transform = "rotateX(" + rotateX + "deg) rotateY(" + rotateY + "deg) rotateZ(" + rotateZ + "deg)";
    }
    setLive("phone:x", format(rotateX, 1) + "deg");
    setLive("phone:y", format(rotateY, 1) + "deg");
    setLive("phone:z", format(rotateZ, 1) + "deg");
  }

  function updateRaw(data) {
    var text = "{}";
    if (data.latest && data.latest.payload) {
      text = JSON.stringify(data.latest.payload, null, 2);
    } else if (data.latestRawPacket && data.latestRawPacket.text) {
      text = data.latestRawPacket.text;
    }
    setLive("raw-packet", text);
    setLive("packet-sender", (data.latest && data.latest.meta && data.latest.meta.remote) || (data.latestRawPacket && data.latestRawPacket.remote) || "no sender");
  }

  function setConnection(state, label) {
    var pill = first("connection-pill");
    if (pill) {
      pill.className = "status-pill " + state;
    }
    setLive("connection-label", label || state);
  }

  function updateFromLatest(data) {
    pollCount += 1;
    var stats = data.stats || { receivedPackets: 0, invalidPackets: 0 };
    setLive("browser-api", "ok");
    setLive("browser-ticks", pollCount);
    setLive("packets", stats.receivedPackets || 0);
    setLive("bad-json", stats.invalidPackets || 0);

    if (data.latest && data.latest.payload) {
      var id = packetId(data.latest.meta);
      setLive("poll", "packet seen");
      setConnection("live", "live");
      updateRaw(data);
      setLive("last-seen", "now");
      setLive("packet-sender", data.latest.meta && data.latest.meta.remote ? data.latest.meta.remote : "sender");
      if (id !== lastPacketId) {
        lastPacketId = id;
        var meters = buildMeters(data.latest.payload);
        meters.forEach(updateMeter);
        updatePhone(data.latest.payload, meters);
      }
      return;
    }

    if (data.latestRawPacket) {
      setLive("poll", "raw only");
      setConnection("live", "live");
      updateRaw(data);
      return;
    }

    setLive("poll", "waiting");
  }

  function pollLatest() {
    fetch("/api/latest?t=" + Date.now(), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(updateFromLatest)
      .catch(function (error) {
        setLive("poll", "failed " + (error && error.message ? error.message : "error"));
        setConnection("offline", "offline");
      });
  }

  function loadRuntime() {
    fetch("/api/runtime?t=" + Date.now(), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then(function (runtime) {
        var lan = runtime.lanAddresses && runtime.lanAddresses[0];
        setLive("browser-api", "ok");
        setLive("udp-port", runtime.udpPort || 41234);
        setLive("udp-target", lan ? lan + ":" + runtime.udpPort : "this-computer:" + (runtime.udpPort || 41234));
        setLive("dashboard-address", lan ? "http://" + lan + ":" + runtime.webPort : window.location.origin);
      })
      .catch(function (error) {
        setLive("browser-api", "failed " + (error && error.message ? error.message : "error"));
      });
  }

  onReady(function () {
    var slider = document.querySelector('[data-control="sensitivity"]');
    if (slider) {
      sensitivity = Number(slider.value) || 1;
      slider.addEventListener("input", function () {
        sensitivity = Number(slider.value) || 1;
        setLive("sensitivity", sensitivity.toFixed(1) + "x");
      });
    }

    loadRuntime();
    pollLatest();
    window.setInterval(pollLatest, 250);
  });
})();
`;

export default function Home() {
  return (
    <>
      <TelemetryDashboard />
      <script dangerouslySetInnerHTML={{ __html: liveDashboardScript }} />
    </>
  );
}
