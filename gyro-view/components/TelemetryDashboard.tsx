"use client";

import {
  Activity,
  Antenna,
  Gauge,
  Magnet,
  Pause,
  Play,
  RadioTower,
  Rotate3D,
  Sparkles,
  Target,
  Trash2,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  axisToSample,
  clamp,
  emptySample,
  formatValue,
  type MeterSample,
  type PacketMeta,
  type PhoneMotionPayload,
  rotationToSample,
  type RuntimeConfig,
  samplePacket
} from "@/lib/telemetry";

type ConnectionState = "connecting" | "live" | "offline";

type HistoryMap = Record<string, MeterSample[]>;
type BaselineMap = Record<string, MeterSample>;

type LatestResponse = {
  latest?: {
    payload: PhoneMotionPayload;
    meta: PacketMeta;
  } | null;
  latestRawPacket?: {
    bytes: number;
    receivedAtServer: string;
    remote: string;
    text: string;
  } | null;
  stats?: {
    receivedPackets: number;
    invalidPackets: number;
  };
};

type MeterConfig = {
  key: string;
  title: string;
  units: string;
  range: number;
  icon: React.ReactNode;
  sample: MeterSample;
  sequence?: number;
  receivedAt?: string;
};

type MeterBase = Omit<MeterConfig, "icon">;

const maxHistory = 96;

const zeroBaseline = (sample: MeterSample, baseline?: MeterSample): MeterSample => {
  if (!baseline) {
    return sample;
  }

  const x = sample.x - baseline.x;
  const y = sample.y - baseline.y;
  const z = sample.z - baseline.z;

  return {
    x,
    y,
    z,
    magnitude: Math.sqrt(x * x + y * y + z * z)
  };
};

const appendHistory = (history: HistoryMap, meters: MeterBase[]) => {
  const next = { ...history };

  for (const meter of meters) {
    const values = next[meter.key] ?? [];
    next[meter.key] = [...values, meter.sample].slice(-maxHistory);
  }

  return next;
};

const timeAgo = (iso?: string) => {
  if (!iso) {
    return "waiting";
  }

  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta)) {
    return "waiting";
  }

  if (delta < 1000) {
    return "now";
  }

  return `${Math.round(delta / 1000)}s ago`;
};

const buildMeterBases = (nextPayload: PhoneMotionPayload | null): MeterBase[] => {
  const telemetry = nextPayload?.telemetry;
  const deviceMotion = telemetry?.deviceMotion?.data;

  return [
    {
      key: "gyroscope",
      title: "Gyroscope",
      units: telemetry?.gyroscope?.units ?? "rad/s",
      range: 1,
      sample: axisToSample(telemetry?.gyroscope?.data),
      sequence: telemetry?.gyroscope?.sequence,
      receivedAt: telemetry?.gyroscope?.receivedAt
    },
    {
      key: "accelerometer",
      title: "Accelerometer",
      units: telemetry?.accelerometer?.units ?? "g",
      range: 2,
      sample: axisToSample(telemetry?.accelerometer?.data),
      sequence: telemetry?.accelerometer?.sequence,
      receivedAt: telemetry?.accelerometer?.receivedAt
    },
    {
      key: "magnetometer",
      title: "Magnetometer",
      units: telemetry?.magnetometer?.units ?? "microtesla",
      range: 80,
      sample: axisToSample(telemetry?.magnetometer?.data),
      sequence: telemetry?.magnetometer?.sequence,
      receivedAt: telemetry?.magnetometer?.receivedAt
    },
    {
      key: "motion-acceleration",
      title: "Motion Acceleration",
      units: "m/s^2",
      range: 6,
      sample: axisToSample(deviceMotion?.acceleration),
      sequence: telemetry?.deviceMotion?.sequence,
      receivedAt: telemetry?.deviceMotion?.receivedAt
    },
    {
      key: "gravity",
      title: "Gravity Vector",
      units: "m/s^2",
      range: 12,
      sample: axisToSample(deviceMotion?.accelerationIncludingGravity),
      sequence: telemetry?.deviceMotion?.sequence,
      receivedAt: telemetry?.deviceMotion?.receivedAt
    },
    {
      key: "rotation",
      title: "Rotation",
      units: "degrees",
      range: 90,
      sample: rotationToSample(deviceMotion?.rotation),
      sequence: telemetry?.deviceMotion?.sequence,
      receivedAt: telemetry?.deviceMotion?.receivedAt
    },
    {
      key: "rotation-rate",
      title: "Rotation Rate",
      units: "deg/s",
      range: 8,
      sample: rotationToSample(deviceMotion?.rotationRate),
      sequence: telemetry?.deviceMotion?.sequence,
      receivedAt: telemetry?.deviceMotion?.receivedAt
    }
  ];
};

const useRuntimeConfig = () => {
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/runtime")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        setConfig(data);
        setError(null);
      })
      .catch((nextError: unknown) => {
        setError(nextError instanceof Error ? nextError.message : "failed");
      });
  }, []);

  return { config, error };
};

export function TelemetryDashboard() {
  const { config: runtime, error: runtimeError } = useRuntimeConfig();
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [payload, setPayload] = useState<PhoneMotionPayload | null>(null);
  const [meta, setMeta] = useState<PacketMeta | null>(null);
  const [rawPacket, setRawPacket] = useState<LatestResponse["latestRawPacket"]>(null);
  const [history, setHistory] = useState<HistoryMap>({});
  const [baseline, setBaseline] = useState<BaselineMap>({});
  const [paused, setPaused] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [sensitivity, setSensitivity] = useState(1);
  const [invalidPackets, setInvalidPackets] = useState(0);
  const [pollStatus, setPollStatus] = useState("starting");
  const [pollCount, setPollCount] = useState(0);
  const [lastPollAt, setLastPollAt] = useState<string | null>(null);
  const [receivedPackets, setReceivedPackets] = useState(0);
  const pausedRef = useRef(paused);
  const baselineRef = useRef(baseline);
  const sensitivityRef = useRef(sensitivity);
  const lastPacketIdRef = useRef<string | null>(null);
  const tickRef = useRef(0);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  const rawMeters = useMemo<MeterConfig[]>(
    () =>
      buildMeterBases(payload).map((meter) => ({
        ...meter,
        icon:
          meter.key === "gyroscope" ? (
            <Rotate3D size={18} />
          ) : meter.key === "accelerometer" ? (
            <Zap size={18} />
          ) : meter.key === "magnetometer" ? (
            <Magnet size={18} />
          ) : meter.key === "motion-acceleration" ? (
            <Activity size={18} />
          ) : meter.key === "gravity" ? (
            <Target size={18} />
          ) : meter.key === "rotation" ? (
            <Gauge size={18} />
          ) : (
            <Sparkles size={18} />
          )
      })),
    [payload]
  );

  const meters = useMemo(
    () =>
      rawMeters.map((meter) => ({
        ...meter,
        range: meter.range / sensitivity,
        sample: zeroBaseline(meter.sample, baseline[meter.key])
      })),
    [baseline, rawMeters, sensitivity]
  );

  const ingest = useCallback((nextPayload: PhoneMotionPayload, nextMeta?: PacketMeta) => {
    if (nextMeta) {
      const packetId = `${nextMeta.remote}-${nextMeta.receivedPackets}-${nextMeta.receivedAtServer}`;
      if (packetId === lastPacketIdRef.current) {
        return;
      }
      lastPacketIdRef.current = packetId;
    }

    setPayload(nextPayload);
    if (nextMeta) {
      setMeta(nextMeta);
    }
    if (!pausedRef.current) {
      const historyMeters = buildMeterBases(nextPayload).map((meter) => ({
        ...meter,
        range: meter.range / sensitivityRef.current,
        sample: zeroBaseline(meter.sample, baselineRef.current[meter.key])
      }));
      setHistory((current) => appendHistory(current, historyMeters));
    }
  }, []);

  useEffect(() => {
    if (demoMode) {
      return;
    }

    const pollLatest = async () => {
      try {
        const response = await fetch(`${window.location.origin}/api/latest?t=${Date.now()}`, {
          cache: "no-store",
          headers: {
            "cache-control": "no-cache",
            pragma: "no-cache"
          }
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json()) as LatestResponse;
        setConnection("live");
        setPollCount((count) => count + 1);
        setLastPollAt(new Date().toISOString());
        setRawPacket(data.latestRawPacket ?? null);
        setPollStatus(data.latest?.payload ? "packet seen" : data.latestRawPacket ? "raw only" : "waiting");

        if (data.stats) {
          setReceivedPackets(data.stats.receivedPackets);
          setInvalidPackets(data.stats.invalidPackets);
        }

        if (data.latest?.payload && !pausedRef.current) {
          ingest(data.latest.payload, data.latest.meta);
        }
      } catch (nextError: unknown) {
        setPollStatus(nextError instanceof Error ? `poll ${nextError.message}` : "poll failed");
        setConnection("offline");
      }
    };

    pollLatest();
    const id = window.setInterval(pollLatest, 250);

    return () => window.clearInterval(id);
  }, [demoMode, ingest]);

  useEffect(() => {
    if (!demoMode) {
      return;
    }

    const id = window.setInterval(() => {
      if (pausedRef.current) {
        return;
      }

      tickRef.current += 1;
      ingest(samplePacket(tickRef.current), {
        bytes: 0,
        receivedAtServer: new Date().toISOString(),
        remote: "demo-signal",
        receivedPackets: tickRef.current,
        invalidPackets
      });
      setConnection("live");
      setPollStatus("demo");
      setReceivedPackets(tickRef.current);
    }, 100);

    return () => window.clearInterval(id);
  }, [demoMode, ingest, invalidPackets]);

  const calibrate = () => {
    const next: BaselineMap = {};
    for (const meter of rawMeters) {
      next[meter.key] = meter.sample;
    }
    setBaseline(next);
  };

  const clear = () => {
    setHistory({});
    setBaseline({});
  };

  const dashboardAddress =
    runtime?.lanAddresses?.[0] ? `http://${runtime.lanAddresses[0]}:${runtime.webPort}` : "http://localhost:3000";
  const udpTarget = runtime?.lanAddresses?.[0] ? `${runtime.lanAddresses[0]}:${runtime.udpPort}` : `this-computer:${runtime?.udpPort ?? 41234}`;
  const rotation = payload?.telemetry?.deviceMotion?.data.rotation;
  const gravity = meters.find((meter) => meter.key === "gravity")?.sample ?? emptySample;

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="title-block">
          <div className="mark">
            <RadioTower size={24} />
          </div>
          <div>
            <p className="eyebrow">UDP phone telemetry</p>
            <h1>Gyro View</h1>
          </div>
        </div>

        <div className="status-strip">
          <StatusPill state={demoMode ? "live" : connection} label={demoMode ? "demo" : connection} />
          <InfoChip label="UDP" value={String(runtime?.udpPort ?? 41234)} liveKey="udp-port" />
          <InfoChip label="Target" value={udpTarget} liveKey="udp-target" />
          <InfoChip label="Browser API" value={runtimeError ? `failed ${runtimeError}` : runtime ? "ok" : "loading"} liveKey="browser-api" />
          <InfoChip label="Poll" value={pollStatus} liveKey="poll" />
          <InfoChip label="Browser Ticks" value={String(pollCount)} liveKey="browser-ticks" />
          <InfoChip label="Packets" value={String(meta?.receivedPackets ?? receivedPackets)} liveKey="packets" />
          <InfoChip label="Bad JSON" value={String(invalidPackets)} liveKey="bad-json" />
        </div>
      </section>

      <section className="control-band">
        <div className="address-block">
          <span>Dashboard</span>
          <strong data-live="dashboard-address">{dashboardAddress}</strong>
        </div>
        <div className="controls">
          <button className="icon-button" type="button" onClick={() => setPaused((value) => !value)} title={paused ? "Resume" : "Pause"}>
            {paused ? <Play size={18} /> : <Pause size={18} />}
            <span>{paused ? "Resume" : "Pause"}</span>
          </button>
          <button className="icon-button" type="button" onClick={() => setDemoMode((value) => !value)} title="Demo signal">
            <Antenna size={18} />
            <span>{demoMode ? "Demo On" : "Demo Off"}</span>
          </button>
          <button className="icon-button" type="button" onClick={calibrate} title="Zero current values">
            <Target size={18} />
            <span>Zero</span>
          </button>
          <button className="icon-button ghost" type="button" onClick={clear} title="Clear history">
            <Trash2 size={18} />
            <span>Clear</span>
          </button>
          <label className="slider-control">
            <span>Sensitivity</span>
            <input
              min="0.5"
              max="4"
              step="0.1"
              type="range"
              value={sensitivity}
              data-control="sensitivity"
              onChange={(event) => setSensitivity(Number(event.target.value))}
            />
            <strong data-live="sensitivity">{sensitivity.toFixed(1)}x</strong>
          </label>
        </div>
      </section>

      <section className="play-zone">
        <PhoneStage gravity={gravity} rotation={rotation} lastSeen={meta?.receivedAtServer ?? payload?.sentAt} />
        <TrailCanvas sample={meters.find((meter) => meter.key === "accelerometer")?.sample ?? emptySample} paused={paused} />
        <RawPanel payload={payload} meta={meta} rawPacket={rawPacket} pollStatus={pollStatus} lastPollAt={lastPollAt} />
      </section>

      <section className="meter-grid">
        {meters.map((meter) => (
          <MeterPanel key={meter.key} meter={meter} history={history[meter.key] ?? []} />
        ))}
      </section>
    </main>
  );
}

function StatusPill({ state, label }: { state: ConnectionState; label: string }) {
  return (
    <div className={`status-pill ${state}`} data-live="connection-pill">
      <span />
      <strong data-live="connection-label">{label}</strong>
    </div>
  );
}

function InfoChip({ label, value, liveKey }: { label: string; value: string; liveKey?: string }) {
  return (
    <div className="info-chip">
      <span>{label}</span>
      <strong data-live={liveKey}>{value}</strong>
    </div>
  );
}

function PhoneStage({
  gravity,
  rotation,
  lastSeen
}: {
  gravity: MeterSample;
  rotation?: { alpha?: number; beta?: number; gamma?: number };
  lastSeen?: string;
}) {
  const rotateX = clamp(rotation?.beta ?? gravity.y * -9, -70, 70);
  const rotateY = clamp(rotation?.gamma ?? gravity.x * 9, -70, 70);
  const rotateZ = clamp((rotation?.alpha ?? 0) / 6, -35, 35);

  return (
    <div className="stage-panel">
      <div className="panel-heading">
        <span>
          <Rotate3D size={18} /> Phone attitude
        </span>
        <small data-live="last-seen">{timeAgo(lastSeen)}</small>
      </div>
      <div className="phone-scene">
        <div
          className="phone-model"
          data-live="phone-model"
          style={{
            transform: `rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg)`
          }}
        >
          <div className="phone-speaker" />
          <div className="phone-orbit">
            <span />
            <span />
            <span />
          </div>
          <div className="phone-dot" />
        </div>
        <div className="shadow" />
      </div>
      <div className="stage-readout">
        <strong data-live="phone:x">{formatValue(rotateX, 1)}°</strong>
        <strong data-live="phone:y">{formatValue(rotateY, 1)}°</strong>
        <strong data-live="phone:z">{formatValue(rotateZ, 1)}°</strong>
      </div>
    </div>
  );
}

function TrailCanvas({ sample, paused }: { sample: MeterSample; paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || paused) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    context.scale(ratio, ratio);
    context.fillStyle = "rgba(12, 18, 22, 0.08)";
    context.fillRect(0, 0, rect.width, rect.height);

    const x = clamp(0.5 + sample.x / 2, 0.04, 0.96);
    const y = clamp(0.5 - sample.y / 2, 0.04, 0.96);
    pointRef.current = {
      x: pointRef.current.x * 0.76 + x * 0.24,
      y: pointRef.current.y * 0.76 + y * 0.24
    };

    const px = pointRef.current.x * rect.width;
    const py = pointRef.current.y * rect.height;
    const radius = clamp(sample.magnitude * 18, 4, 28);
    const gradient = context.createRadialGradient(px, py, 1, px, py, radius);
    gradient.addColorStop(0, "rgba(252, 180, 76, 0.95)");
    gradient.addColorStop(0.45, "rgba(26, 188, 156, 0.48)");
    gradient.addColorStop(1, "rgba(26, 188, 156, 0)");

    context.beginPath();
    context.fillStyle = gradient;
    context.arc(px, py, radius, 0, Math.PI * 2);
    context.fill();
  }, [paused, sample]);

  return (
    <div className="trail-panel">
      <div className="panel-heading">
        <span>
          <Sparkles size={18} /> Accel trail
        </span>
        <small>{formatValue(sample.magnitude, 3)} g</small>
      </div>
      <canvas ref={canvasRef} className="trail-canvas" />
    </div>
  );
}

function RawPanel({
  payload,
  meta,
  rawPacket,
  pollStatus,
  lastPollAt
}: {
  payload: PhoneMotionPayload | null;
  meta: PacketMeta | null;
  rawPacket: LatestResponse["latestRawPacket"];
  pollStatus: string;
  lastPollAt: string | null;
}) {
  const text = payload
    ? JSON.stringify(payload, null, 2)
    : rawPacket?.text
      ? rawPacket.text
      : JSON.stringify({ pollStatus, lastPollAt }, null, 2);

  return (
    <div className="raw-panel">
      <div className="panel-heading">
        <span>
          <Activity size={18} /> Packet
        </span>
        <small data-live="packet-sender">{meta?.remote ?? rawPacket?.remote ?? "no sender"}</small>
      </div>
      <pre data-live="raw-packet">{text}</pre>
    </div>
  );
}

function MeterPanel({ meter, history }: { meter: MeterConfig; history: MeterSample[] }) {
  return (
    <article className="meter-panel">
      <div className="meter-topline">
        <div className="meter-title">
          {meter.icon}
          <div>
            <h2>{meter.title}</h2>
            <span>{meter.units}</span>
          </div>
        </div>
        <div className="sequence" data-live={`meter:${meter.key}:sequence`}>#{meter.sequence ?? 0}</div>
      </div>

      <div className="magnitude-row">
        <RadialGauge value={meter.sample.magnitude} range={meter.range} meterKey={meter.key} />
        <div>
          <strong data-live={`meter:${meter.key}:magnitude`}>{formatValue(meter.sample.magnitude, 3)}</strong>
          <span>magnitude</span>
        </div>
      </div>

      <div className="axis-stack">
        <AxisBar meterKey={meter.key} axis="x" value={meter.sample.x} range={meter.range} />
        <AxisBar meterKey={meter.key} axis="y" value={meter.sample.y} range={meter.range} />
        <AxisBar meterKey={meter.key} axis="z" value={meter.sample.z} range={meter.range} />
      </div>

      <Sparkline meterKey={meter.key} history={history} range={meter.range} />
    </article>
  );
}

function AxisBar({
  meterKey,
  axis,
  value,
  range
}: {
  meterKey: string;
  axis: "x" | "y" | "z";
  value: number;
  range: number;
}) {
  const percentage = clamp(Math.abs(value) / range, 0, 1) * 50;
  const left = value < 0 ? 50 - percentage : 50;

  return (
    <div className="axis-row">
      <span className={`axis-label ${axis}`}>{axis}</span>
      <div className="axis-track">
        <div className={`axis-fill ${axis}`} data-live={`meter:${meterKey}:${axis}:fill`} style={{ left: `${left}%`, width: `${percentage}%` }} />
        <span className="axis-zero" />
      </div>
      <strong data-live={`meter:${meterKey}:${axis}`}>{formatValue(value, 3)}</strong>
    </div>
  );
}

function RadialGauge({ value, range, meterKey }: { value: number; range: number; meterKey: string }) {
  const turn = clamp(value / range, 0, 1) * 270;

  return (
    <div className="radial-gauge" data-live={`meter:${meterKey}:gauge`} style={{ "--gauge": `${turn}deg` } as React.CSSProperties}>
      <span />
    </div>
  );
}

function Sparkline({ meterKey, history, range }: { meterKey: string; history: MeterSample[]; range: number }) {
  const points = history.length
    ? history
        .map((sample, index) => {
          const x = (index / Math.max(1, history.length - 1)) * 100;
          const y = 100 - clamp(sample.magnitude / range, 0, 1) * 100;
          return `${x},${y}`;
        })
        .join(" ")
    : "0,100 100,100";

  return (
    <svg className="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline data-live={`meter:${meterKey}:spark`} points={points} />
    </svg>
  );
}
