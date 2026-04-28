import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import dgram from 'react-native-udp';
import {
  Accelerometer,
  DeviceMotion,
  type DeviceMotionMeasurement,
  Gyroscope,
  Magnetometer,
  type MagnetometerMeasurement,
} from 'expo-sensors';

const SENSOR_INTERVAL_MS = 100;
const MAX_LOG_LINES = 18;
const SENSOR_NAMES: SensorName[] = ['gyroscope', 'accelerometer', 'magnetometer', 'deviceMotion'];

type ThreeAxisMeasurement = {
  x: number;
  y: number;
  z: number;
  timestamp: number;
};

type SensorName = 'gyroscope' | 'accelerometer' | 'magnetometer' | 'deviceMotion';

type SensorPacket<T> = {
  source: SensorName;
  units: string;
  receivedAt: string;
  sequence: number;
  data: T;
};

type SensorAvailability = Record<SensorName, boolean | null>;

type SensorSubscription = {
  remove: () => void;
};

type UdpSocket = {
  bind: (port?: number, address?: string, callback?: () => void) => void;
  close: () => number | undefined;
  on: (event: 'error', listener: (error: Error) => void) => UdpSocket;
  once: (event: 'listening', listener: () => void) => UdpSocket;
  send: (
    message: string,
    offset: undefined,
    length: undefined,
    port: number,
    address: string,
    callback: (error?: Error) => void,
  ) => void;
};

type UdpTarget = {
  host: string;
  port: number;
};

type SelectedMeters = Record<SensorName, boolean>;

type TelemetryState = {
  gyroscope: SensorPacket<ThreeAxisMeasurement> | null;
  accelerometer: SensorPacket<ThreeAxisMeasurement> | null;
  magnetometer: SensorPacket<MagnetometerMeasurement> | null;
  deviceMotion: SensorPacket<DeviceMotionMeasurement> | null;
};

const initialTelemetry: TelemetryState = {
  gyroscope: null,
  accelerometer: null,
  magnetometer: null,
  deviceMotion: null,
};

const initialAvailability: SensorAvailability = {
  gyroscope: null,
  accelerometer: null,
  magnetometer: null,
  deviceMotion: null,
};

const initialSelectedMeters: SelectedMeters = {
  gyroscope: true,
  accelerometer: true,
  magnetometer: true,
  deviceMotion: true,
};

export default function App() {
  const [telemetry, setTelemetry] = useState<TelemetryState>(initialTelemetry);
  const [availability, setAvailability] = useState<SensorAvailability>(initialAvailability);
  const [isStreaming, setIsStreaming] = useState(true);
  const [udpUrl, setUdpUrl] = useState('');
  const [selectedMeters, setSelectedMeters] = useState<SelectedMeters>(initialSelectedMeters);
  const [isUdpStreaming, setIsUdpStreaming] = useState(false);
  const [udpStatus, setUdpStatus] = useState('Enter a UDP target and choose meters to stream.');
  const [copyStatus, setCopyStatus] = useState('');
  const [logLines, setLogLines] = useState<string[]>([]);
  const sequenceRef = useRef(0);
  const udpSequenceRef = useRef(0);
  const udpSocketRef = useRef<UdpSocket | null>(null);
  const udpTargetRef = useRef<UdpTarget | null>(null);

  useEffect(() => {
    if (!isStreaming) {
      console.log('[gyro-test] sensor streaming paused');
      return;
    }

    let isMounted = true;
    const subscriptions: SensorSubscription[] = [];

    const nextPacket = <T,>(source: SensorName, units: string, data: T): SensorPacket<T> => ({
      source,
      units,
      receivedAt: new Date().toISOString(),
      sequence: sequenceRef.current++,
      data,
    });

    const publish = <T,>(packet: SensorPacket<T>) => {
      console.log(`[gyro-test:${packet.source}]`, JSON.stringify(packet));

      if (!isMounted) {
        return;
      }

      setTelemetry((current) => ({
        ...current,
        [packet.source]: packet,
      }));
      setLogLines((current) => [
        `${packet.sequence} ${packet.source} ${packet.receivedAt}`,
        ...current.slice(0, MAX_LOG_LINES - 1),
      ]);
    };

    const startSensors = async () => {
      console.log('[gyro-test] checking sensor availability');

      const [gyroscope, accelerometer, magnetometer, deviceMotion] = await Promise.all([
        Gyroscope.isAvailableAsync(),
        Accelerometer.isAvailableAsync(),
        Magnetometer.isAvailableAsync(),
        DeviceMotion.isAvailableAsync(),
      ]);

      if (!isMounted) {
        return;
      }

      setAvailability({ gyroscope, accelerometer, magnetometer, deviceMotion });
      console.log(
        '[gyro-test:availability]',
        JSON.stringify({ gyroscope, accelerometer, magnetometer, deviceMotion }),
      );

      Gyroscope.setUpdateInterval(SENSOR_INTERVAL_MS);
      Accelerometer.setUpdateInterval(SENSOR_INTERVAL_MS);
      Magnetometer.setUpdateInterval(SENSOR_INTERVAL_MS);
      DeviceMotion.setUpdateInterval(SENSOR_INTERVAL_MS);

      if (gyroscope) {
        subscriptions.push(
          Gyroscope.addListener((data) =>
            publish(nextPacket('gyroscope', 'radians/second', data)),
          ),
        );
      }

      if (accelerometer) {
        subscriptions.push(
          Accelerometer.addListener((data) =>
            publish(nextPacket('accelerometer', 'g-force', data)),
          ),
        );
      }

      if (magnetometer) {
        subscriptions.push(
          Magnetometer.addListener((data) =>
            publish(nextPacket('magnetometer', 'microtesla', data)),
          ),
        );
      }

      if (deviceMotion) {
        subscriptions.push(
          DeviceMotion.addListener((data) =>
            publish(nextPacket('deviceMotion', 'mixed: m/s^2, degrees/second, degrees', data)),
          ),
        );
      }
    };

    startSensors().catch((error: unknown) => {
      console.error('[gyro-test:error] failed to start sensors', error);
    });

    return () => {
      isMounted = false;
      subscriptions.forEach((subscription) => subscription.remove());
      console.log('[gyro-test] sensor subscriptions removed');
    };
  }, [isStreaming]);

  useEffect(() => {
    return () => {
      udpSocketRef.current?.close();
      udpSocketRef.current = null;
      udpTargetRef.current = null;
    };
  }, []);

  const selectedTelemetry = useMemo(() => {
    const meters = {} as Partial<TelemetryState>;

    SENSOR_NAMES.forEach((name) => {
      if (selectedMeters[name] && availability[name] && telemetry[name]) {
        meters[name] = telemetry[name] as never;
      }
    });

    return meters;
  }, [availability, selectedMeters, telemetry]);

  const udpPayloadPreview = useMemo(
    () =>
      JSON.stringify(
        {
          type: 'phone-motion',
          sentAt: new Date().toISOString(),
          intervalMs: SENSOR_INTERVAL_MS,
          telemetry: selectedTelemetry,
        },
        null,
        2,
      ),
    [selectedTelemetry],
  );

  useEffect(() => {
    if (!isUdpStreaming) {
      return;
    }

    const selectedCount = Object.keys(selectedTelemetry).length;

    if (!udpUrl.trim()) {
      setUdpStatus('UDP target is empty. Enter a target like udp://192.168.1.20:41234.');
      return;
    }

    if (selectedCount === 0) {
      setUdpStatus('No available selected meters have data yet.');
      return;
    }

    const target = udpTargetRef.current;
    const socket = udpSocketRef.current;

    if (!target || !socket) {
      setUdpStatus('UDP socket is not ready yet.');
      return;
    }

    const packet = {
      type: 'phone-motion',
      target: `udp://${target.host}:${target.port}`,
      sentAt: new Date().toISOString(),
      intervalMs: SENSOR_INTERVAL_MS,
      sequence: udpSequenceRef.current++,
      telemetry: selectedTelemetry,
    };
    const message = JSON.stringify(packet);

    console.log('[gyro-test:udp]', message);
    socket.send(message, undefined, undefined, target.port, target.host, (error?: Error) => {
      if (error) {
        console.error('[gyro-test:udp:error]', error);
        setUdpStatus(`UDP send failed: ${error.message}`);
        return;
      }

      setUdpStatus(`Streaming ${selectedCount} selected meter(s) to ${target.host}:${target.port}`);
    });
  }, [isUdpStreaming, selectedTelemetry, udpUrl]);

  const toggleMeter = (name: SensorName) => {
    if (!availability[name]) {
      return;
    }

    setSelectedMeters((current) => ({
      ...current,
      [name]: !current[name],
    }));
  };

  const connectAndStream = () => {
    const parsedTarget = parseUdpTarget(udpUrl);

    if (!parsedTarget) {
      setUdpStatus('Enter a valid UDP target. Example: udp://192.168.1.20:41234');
      stopUdpStream();
      return;
    }

    if (!SENSOR_NAMES.some((name) => selectedMeters[name] && availability[name])) {
      setUdpStatus('Select at least one available meter before streaming.');
      stopUdpStream();
      return;
    }

    stopUdpStream();
    udpSequenceRef.current = 0;
    setUdpStatus(`Connecting to ${parsedTarget.host}:${parsedTarget.port}...`);

    try {
      const socket = dgram.createSocket({ type: 'udp4', debug: true }) as UdpSocket;

      socket.on('error', (error: Error) => {
        console.error('[gyro-test:udp:error]', error);
        setUdpStatus(`UDP socket error: ${error.message}`);
        stopUdpStream();
      });

      socket.once('listening', () => {
        udpSocketRef.current = socket;
        udpTargetRef.current = parsedTarget;
        setIsUdpStreaming(true);
        setUdpStatus(`Streaming to ${parsedTarget.host}:${parsedTarget.port}`);
      });

      socket.bind(0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[gyro-test:udp:error] failed to create UDP socket', error);
      setUdpStatus(
        `Native UDP is not available in this app build. Use a development build. ${message}`,
      );
      stopUdpStream();
    }
  };

  const stopUdpStream = () => {
    setIsUdpStreaming(false);
    udpSocketRef.current?.close();
    udpSocketRef.current = null;
    udpTargetRef.current = null;
  };

  const copyUdpPayloadPreview = async () => {
    await Clipboard.setStringAsync(udpPayloadPreview);
    setCopyStatus('Copied JSON');

    setTimeout(() => {
      setCopyStatus('');
    }, 1400);
  };

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>React Native phone telemetry</Text>
          <Text style={styles.title}>Gyro Logger</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsStreaming((current) => !current)}
          style={({ pressed }) => [
            styles.streamButton,
            !isStreaming && styles.streamButtonPaused,
            pressed && styles.streamButtonPressed,
          ]}
        >
          <Text style={styles.streamButtonText}>{isStreaming ? 'Pause' : 'Start'}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.statusGrid}>
          {Object.entries(availability).map(([name, value]) => (
            <View key={name} style={styles.statusItem}>
              <Text style={styles.statusLabel}>{name}</Text>
              <Text style={[styles.statusValue, value === false && styles.statusUnavailable]}>
                {value === null ? 'checking' : value ? 'available' : 'missing'}
              </Text>
            </View>
          ))}
        </View>

        <SensorCard
          title="Gyroscope"
          description="Rotation rate around x/y/z axes in radians per second."
          packet={telemetry.gyroscope}
        />
        <SensorCard
          title="Accelerometer"
          description="Acceleration along x/y/z axes in g-force."
          packet={telemetry.accelerometer}
        />
        <SensorCard
          title="Magnetometer"
          description="Magnetic field around x/y/z axes in microtesla."
          packet={telemetry.magnetometer}
        />
        <SensorCard
          title="Device Motion"
          description="Combined acceleration, gravity, rotation, rotation rate, interval, and orientation."
          packet={telemetry.deviceMotion}
        />

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Console Log</Text>
          <Text style={styles.panelBody}>
            Move the phone and watch Metro, Expo DevTools, or the native debug console for
            `[gyro-test:*]` JSON packets.
          </Text>
          {logLines.map((line) => (
            <Text key={line} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeaderRow}>
            <Text style={styles.panelTitle}>UDP Payload Preview</Text>
            <Pressable
              accessibilityRole="button"
              onPress={copyUdpPayloadPreview}
              style={({ pressed }) => [styles.copyButton, pressed && styles.streamButtonPressed]}
            >
              <Text style={styles.copyButtonText}>Copy</Text>
            </Pressable>
          </View>
          {copyStatus ? <Text style={styles.copyStatus}>{copyStatus}</Text> : null}
          <Text style={styles.codeBlock}>{udpPayloadPreview}</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>UDP Stream</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={setUdpUrl}
            placeholder="udp://192.168.1.20:41234"
            placeholderTextColor="#6f7d85"
            style={styles.input}
            value={udpUrl}
          />

          <View style={styles.checkboxList}>
            {SENSOR_NAMES.map((name) => {
              const isAvailable = availability[name] === true;
              const isChecked = selectedMeters[name] && isAvailable;

              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isChecked, disabled: !isAvailable }}
                  disabled={!isAvailable}
                  key={name}
                  onPress={() => toggleMeter(name)}
                  style={({ pressed }) => [
                    styles.checkboxRow,
                    !isAvailable && styles.checkboxRowDisabled,
                    pressed && styles.checkboxRowPressed,
                  ]}
                >
                  <View style={[styles.checkbox, isChecked && styles.checkboxChecked]}>
                    {isChecked && <Text style={styles.checkboxMark}>✓</Text>}
                  </View>
                  <View style={styles.checkboxTextWrap}>
                    <Text style={[styles.checkboxLabel, !isAvailable && styles.checkboxDisabledText]}>
                      {name}
                    </Text>
                    <Text style={styles.checkboxHint}>
                      {isAvailable ? 'included when checked' : 'not available on this device'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={connectAndStream}
            style={({ pressed }) => [
              styles.connectButton,
              isUdpStreaming && styles.connectButtonActive,
              pressed && styles.streamButtonPressed,
            ]}
          >
            <Text style={styles.connectButtonText}>Connect and Stream</Text>
          </Pressable>
          <Text style={styles.udpStatus}>{udpStatus}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function parseUdpTarget(value: string): UdpTarget | null {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const normalizedValue = trimmedValue.includes('://') ? trimmedValue : `udp://${trimmedValue}`;

  try {
    const url = new URL(normalizedValue);
    const port = Number(url.port);

    if (url.protocol !== 'udp:' || !url.hostname || !Number.isInteger(port) || port <= 0) {
      return null;
    }

    return {
      host: url.hostname,
      port,
    };
  } catch {
    return null;
  }
}

function SensorCard<T>({ title, description, packet }: {
  title: string;
  description: string;
  packet: SensorPacket<T> | null;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardDescription}>{description}</Text>
        </View>
        <Text style={styles.cardBadge}>{packet ? `#${packet.sequence}` : 'waiting'}</Text>
      </View>
      <Text style={styles.codeBlock}>
        {packet ? JSON.stringify(packet.data, null, 2) : 'Waiting for sensor data...'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#101417',
  },
  header: {
    alignItems: 'center',
    backgroundColor: '#151b1f',
    borderBottomColor: '#2b3439',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 16,
    paddingTop: 20,
  },
  eyebrow: {
    color: '#7bdcb5',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  title: {
    color: '#f5f7f8',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0,
    marginTop: 2,
  },
  streamButton: {
    alignItems: 'center',
    backgroundColor: '#13a76b',
    borderRadius: 8,
    minWidth: 82,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  streamButtonPaused: {
    backgroundColor: '#3b4650',
  },
  streamButtonPressed: {
    opacity: 0.75,
  },
  streamButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  content: {
    gap: 14,
    padding: 16,
    paddingBottom: 32,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statusItem: {
    backgroundColor: '#1b2328',
    borderColor: '#303b42',
    borderRadius: 8,
    borderWidth: 1,
    minWidth: '47%',
    padding: 12,
  },
  statusLabel: {
    color: '#aeb9bf',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  statusValue: {
    color: '#7bdcb5',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
    marginTop: 4,
  },
  statusUnavailable: {
    color: '#ff9a8b',
  },
  card: {
    backgroundColor: '#1b2328',
    borderColor: '#303b42',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitle: {
    color: '#f5f7f8',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0,
  },
  cardDescription: {
    color: '#aeb9bf',
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 18,
    marginTop: 3,
    maxWidth: 260,
  },
  cardBadge: {
    color: '#7bdcb5',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    paddingTop: 3,
  },
  panel: {
    backgroundColor: '#151b1f',
    borderColor: '#303b42',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
  },
  panelTitle: {
    color: '#f5f7f8',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 6,
  },
  panelHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  copyButton: {
    alignItems: 'center',
    backgroundColor: '#263139',
    borderColor: '#3c4a52',
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 68,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  copyButtonText: {
    color: '#f5f7f8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
  },
  copyStatus: {
    color: '#7bdcb5',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0,
    marginBottom: 8,
  },
  panelBody: {
    color: '#aeb9bf',
    fontSize: 14,
    letterSpacing: 0,
    lineHeight: 20,
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#101417',
    borderColor: '#303b42',
    borderRadius: 8,
    borderWidth: 1,
    color: '#f5f7f8',
    fontSize: 15,
    letterSpacing: 0,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  checkboxList: {
    gap: 8,
    marginTop: 14,
  },
  checkboxRow: {
    alignItems: 'center',
    backgroundColor: '#1b2328',
    borderColor: '#303b42',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 10,
  },
  checkboxRowDisabled: {
    opacity: 0.48,
  },
  checkboxRowPressed: {
    opacity: 0.75,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: '#6f7d85',
    borderRadius: 5,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxChecked: {
    backgroundColor: '#13a76b',
    borderColor: '#13a76b',
  },
  checkboxMark: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 18,
  },
  checkboxTextWrap: {
    flex: 1,
  },
  checkboxLabel: {
    color: '#f5f7f8',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  checkboxDisabledText: {
    color: '#aeb9bf',
  },
  checkboxHint: {
    color: '#aeb9bf',
    fontSize: 12,
    letterSpacing: 0,
    marginTop: 2,
  },
  connectButton: {
    alignItems: 'center',
    backgroundColor: '#13a76b',
    borderRadius: 8,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  connectButtonActive: {
    backgroundColor: '#0f8356',
  },
  connectButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
  },
  udpStatus: {
    color: '#aeb9bf',
    fontSize: 13,
    letterSpacing: 0,
    lineHeight: 18,
    marginTop: 10,
  },
  logLine: {
    color: '#d8e0e4',
    fontFamily: 'Courier',
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 18,
  },
  codeBlock: {
    color: '#d8e0e4',
    fontFamily: 'Courier',
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 18,
  },
});
