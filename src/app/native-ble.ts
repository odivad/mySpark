/**
 * Web Bluetooth's shape (SparkBluetooth) over the native BLE plugin, for the Android APK (ADR-0004,
 * amended 2026-09-29: Android's WebView has no Web Bluetooth). Only this adapter differs from the
 * web app; SparkTransport, its write guards and every read-back check are the same code.
 *
 * Talks to @capacitor-community/bluetooth-le 8.3.0 through Capacitor's native bridge directly
 * (`window.Capacitor`), since the app has no bundler (ADR-0005). What it relies on, from the
 * plugin's Android source (BluetoothLe.kt, Device.kt, Conversion.kt):
 * - values travel as hex strings without separators, both ways;
 * - UUIDs are full 128-bit strings; notifications arrive on
 *   `notification|<deviceId>|<service>|<characteristic>`, disconnects on `disconnected|<deviceId>`;
 * - connect requests an MTU of 512 (Chrome does the same), so writes up to the size SparkTransport
 *   already uses fit in one packet. The MTU the amp grants is not reported to us: UNVERIFIED per amp.
 */
import type { SparkBluetooth, SparkBluetoothDevice, SparkGattCharacteristic } from '../spark/transport.js';

interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  nativePromise(plugin: string, method: string, options?: object): Promise<unknown>;
  addListener(plugin: string, event: string, callback: (data: { value?: string } | null) => void): { remove(): Promise<void> };
}

const PLUGIN = 'BluetoothLe';

function bridge(): CapacitorBridge | null {
  const cap = (globalThis as { Capacitor?: CapacitorBridge }).Capacitor;
  return cap?.isNativePlatform?.() ? cap : null;
}

/** True inside the Android APK. */
export function isNativeApp(): boolean {
  return bridge() !== null;
}

/** 16-bit Bluetooth UUID → the full string the plugin takes (and reports). */
export function fullUuid(short: number): string {
  return `0000${short.toString(16).padStart(4, '0')}-0000-1000-8000-00805f9b34fb`;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** SparkBluetooth over the native plugin, or null outside the APK. */
export function nativeBluetooth(): SparkBluetooth | null {
  const cap = bridge();
  if (!cap) return null;
  const call = (method: string, options: object = {}) => cap.nativePromise(PLUGIN, method, options);
  let initialized = false;

  return {
    async requestDevice(options) {
      if (!initialized) {
        // Asks for "Nearby devices" (BLUETOOTH_SCAN / CONNECT); location is not used (manifest: neverForLocation).
        await call('initialize', { androidNeverForLocation: true });
        initialized = true;
      }
      // With Bluetooth off, Android keeps only its background "BLE-only" mode, where an app's scan is
      // refused (SecurityException: BLUETOOTH_PRIVILEGED) and the picker finds nothing (owner's tablet,
      // 2026-09-29). Ask Android to turn Bluetooth on first.
      const enabled = (await call('isEnabled')) as { value?: boolean } | undefined;
      if (!enabled?.value) {
        try {
          await call('requestEnable');
        } catch {
          throw new Error('Bluetooth is off. Turn it on to connect to the amp.');
        }
      }
      const services = options.filters.flatMap((f) => f.services).map(fullUuid);
      const found = (await call('requestDevice', { services })) as { deviceId: string; name?: string };
      const deviceId = found.deviceId;
      const disconnectListeners: Array<() => void> = [];
      let connected = false;
      cap.addListener(PLUGIN, `disconnected|${deviceId}`, () => {
        connected = false;
        for (const l of disconnectListeners) l();
      });

      const characteristic = (service: string, uuid: number): SparkGattCharacteristic => {
        const char = fullUuid(uuid);
        const listeners: Array<() => void> = [];
        const c: { value: DataView | null } & SparkGattCharacteristic = {
          value: null,
          async writeValueWithoutResponse(value) {
            await call('writeWithoutResponse', { deviceId, service, characteristic: char, value: toHex(value) });
          },
          async startNotifications() {
            cap.addListener(PLUGIN, `notification|${deviceId}|${service}|${char}`, (data) => {
              const bytes = fromHex(data?.value ?? '');
              c.value = new DataView(bytes.buffer);
              for (const l of listeners) l();
            });
            await call('startNotifications', { deviceId, service, characteristic: char });
          },
          addEventListener(_type, listener) {
            listeners.push(listener);
          },
        };
        return c;
      };

      const device: SparkBluetoothDevice = {
        name: found.name,
        gatt: {
          get connected() {
            return connected;
          },
          async connect() {
            await call('connect', { deviceId });
            connected = true;
            return {
              async getPrimaryService(uuid: number) {
                const service = fullUuid(uuid);
                return { getCharacteristic: async (c: number) => characteristic(service, c) };
              },
            };
          },
          disconnect() {
            void call('disconnect', { deviceId });
          },
        },
        addEventListener(_type, listener) {
          disconnectListeners.push(listener);
        },
      };
      return device;
    },
  };
}
