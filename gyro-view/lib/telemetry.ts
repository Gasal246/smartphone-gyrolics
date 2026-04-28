export type AxisTriple = {
  x?: number;
  y?: number;
  z?: number;
  timestamp?: number;
};

export type RotationTriple = {
  alpha?: number;
  beta?: number;
  gamma?: number;
  timestamp?: number;
};

export type SensorReading<TData = unknown> = {
  source: string;
  units: string;
  receivedAt: string;
  sequence: number;
  data: TData;
};

export type DeviceMotionData = {
  orientation?: number;
  interval?: number;
  acceleration?: AxisTriple;
  accelerationIncludingGravity?: AxisTriple;
  rotation?: RotationTriple;
  rotationRate?: RotationTriple;
};

export type PhoneMotionPayload = {
  type?: string;
  sentAt?: string;
  intervalMs?: number;
  telemetry?: {
    gyroscope?: SensorReading<AxisTriple>;
    accelerometer?: SensorReading<AxisTriple>;
    magnetometer?: SensorReading<AxisTriple>;
    deviceMotion?: SensorReading<DeviceMotionData>;
    [key: string]: SensorReading<unknown> | undefined;
  };
};

export type TelemetryEnvelope = {
  kind: "hello" | "telemetry" | "invalid";
  serverTime: string;
  payload?: PhoneMotionPayload;
  latest?: {
    payload: PhoneMotionPayload;
    meta: PacketMeta;
  } | null;
  meta?: PacketMeta;
  config?: RuntimeConfig;
  stats?: {
    receivedPackets: number;
    invalidPackets: number;
  };
  error?: string;
};

export type PacketMeta = {
  bytes: number;
  receivedAtServer: string;
  remote: string;
  receivedPackets: number;
  invalidPackets: number;
};

export type RuntimeConfig = {
  udpPort: number;
  webPort: number;
  lanAddresses: string[];
};

export type MeterSample = {
  x: number;
  y: number;
  z: number;
  magnitude: number;
};

export const emptySample: MeterSample = {
  x: 0,
  y: 0,
  z: 0,
  magnitude: 0
};

export const toNumber = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const axisToSample = (axis?: AxisTriple): MeterSample => {
  const x = toNumber(axis?.x);
  const y = toNumber(axis?.y);
  const z = toNumber(axis?.z);

  return {
    x,
    y,
    z,
    magnitude: Math.sqrt(x * x + y * y + z * z)
  };
};

export const rotationToSample = (rotation?: RotationTriple): MeterSample => {
  const x = toNumber(rotation?.alpha);
  const y = toNumber(rotation?.beta);
  const z = toNumber(rotation?.gamma);

  return {
    x,
    y,
    z,
    magnitude: Math.sqrt(x * x + y * y + z * z)
  };
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const formatValue = (value: number, digits = 3) => {
  if (!Number.isFinite(value)) {
    return "0";
  }

  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }

  return value.toFixed(digits);
};

export const samplePacket = (tick: number): PhoneMotionPayload => {
  const now = new Date().toISOString();
  const wave = tick / 12;
  const x = Math.sin(wave);
  const y = Math.cos(wave * 0.8);
  const z = Math.sin(wave * 0.55 + 1.2);

  return {
    type: "phone-motion",
    sentAt: now,
    intervalMs: 100,
    telemetry: {
      gyroscope: {
        source: "gyroscope",
        units: "radians/second",
        receivedAt: now,
        sequence: tick,
        data: {
          x: x * 0.9,
          y: y * 0.7,
          z: z * 0.5,
          timestamp: tick
        }
      },
      accelerometer: {
        source: "accelerometer",
        units: "g-force",
        receivedAt: now,
        sequence: tick,
        data: {
          x: x * 0.18,
          y: y * 0.18,
          z: 0.96 + z * 0.12,
          timestamp: tick
        }
      },
      magnetometer: {
        source: "magnetometer",
        units: "microtesla",
        receivedAt: now,
        sequence: tick,
        data: {
          x: -24 + x * 22,
          y: 8 + y * 18,
          z: -28 + z * 16,
          timestamp: tick
        }
      },
      deviceMotion: {
        source: "deviceMotion",
        units: "mixed: m/s^2, degrees/second, degrees",
        receivedAt: now,
        sequence: tick,
        data: {
          orientation: 0,
          interval: 100,
          acceleration: {
            x: x * 0.45,
            y: y * 0.45,
            z: z * 0.45,
            timestamp: tick
          },
          rotation: {
            alpha: x * 38,
            beta: y * 24,
            gamma: z * 32,
            timestamp: tick
          },
          rotationRate: {
            alpha: y * 2.2,
            beta: z * 1.8,
            gamma: x * 2,
            timestamp: tick
          },
          accelerationIncludingGravity: {
            x: x * 1.9,
            y: y * 1.9,
            z: -9.81 + z * 1.2,
            timestamp: tick
          }
        }
      }
    }
  };
};
