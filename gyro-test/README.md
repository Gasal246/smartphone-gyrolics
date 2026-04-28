# Gyro Test

Expo React Native app for inspecting phone motion sensor data before streaming it.

## Run on a phone

```sh
npm run start
```

Open the project in Expo Go, then move the phone. The app logs structured JSON packets with these tags:

- `[gyro-test:availability]`
- `[gyro-test:gyroscope]`
- `[gyro-test:accelerometer]`
- `[gyro-test:magnetometer]`
- `[gyro-test:deviceMotion]`

The on-screen `UDP Payload Preview` shows the combined JSON shape that can be sent over UDP in the next step.

Below the preview, enter a target such as `udp://192.168.1.20:41234`, choose the meter readings to include, and press `Connect and Stream`. In a development build this sends real UDP packets and logs `[gyro-test:udp]` with the filtered payload.

For actual UDP packets, run a development build because Expo Go does not include `react-native-udp`:

```sh
npm run android:dev
# or
npm run ios:dev
```

Use the computer's LAN IP, not `localhost`. From a phone, `localhost` means the phone itself.

## Sensor interval

The app requests sensor updates every `100ms` in `App.tsx`. Android 12+ may throttle high-rate sensors unless the native app has `android.permission.HIGH_SAMPLING_RATE_SENSORS`, which is already included in `app.json` for development builds.

## UDP note

Expo Go can read these sensors, but native UDP sockets require the included development build setup. Also, browsers cannot directly listen for UDP packets, so the web side will likely need a small local UDP-to-WebSocket bridge unless the target is a Node process.
