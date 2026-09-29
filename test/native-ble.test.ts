import { afterEach, describe, expect, it } from 'vitest';
import { fromHex, fullUuid, nativeBluetooth, toHex } from '../src/app/native-ble.js';

type Listener = (data: { value?: string } | null) => void;

/** A fake of Capacitor's bridge with the BluetoothLe plugin's native API. */
function fakeBridge({ on = true, allowEnable = false } = {}) {
  let bluetoothOn = on;
  const calls: Array<{ method: string; options: Record<string, unknown> }> = [];
  const listeners = new Map<string, Listener>();
  const cap = {
    isNativePlatform: () => true,
    async nativePromise(plugin: string, method: string, options: Record<string, unknown> = {}) {
      expect(plugin).toBe('BluetoothLe');
      calls.push({ method, options });
      if (method === 'requestDevice') return { deviceId: 'AA:BB', name: 'Spark LIVE BLE' };
      if (method === 'isEnabled') return { value: bluetoothOn };
      if (method === 'requestEnable') {
        if (!allowEnable) throw new Error('requestEnable failed.');
        bluetoothOn = true;
      }
      return undefined;
    },
    addListener(_plugin: string, event: string, cb: Listener) {
      listeners.set(event, cb);
      return { remove: async () => {} };
    },
  };
  (globalThis as { Capacitor?: unknown }).Capacitor = cap;
  return { calls, listeners };
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe('native BLE adapter', () => {
  it('asks Android to turn Bluetooth on, and says so when it stays off', async () => {
    const filters = { filters: [{ services: [0xffc0] }] };
    const asked = fakeBridge({ on: false, allowEnable: true });
    await nativeBluetooth()!.requestDevice(filters);
    expect(asked.calls.map((c) => c.method)).toEqual(['initialize', 'isEnabled', 'requestEnable', 'requestDevice']);

    const refused = fakeBridge({ on: false });
    await expect(nativeBluetooth()!.requestDevice(filters)).rejects.toThrow(/Bluetooth is off/);
    expect(refused.calls.map((c) => c.method)).not.toContain('requestDevice');
  });

  it('converts UUIDs and bytes the way the plugin expects', () => {
    expect(fullUuid(0xffc0)).toBe('0000ffc0-0000-1000-8000-00805f9b34fb');
    expect(toHex(new Uint8Array([0xf0, 0x01, 0x0a, 0xf7]))).toBe('f0010af7');
    expect([...fromHex('f0010af7')]).toEqual([0xf0, 0x01, 0x0a, 0xf7]);
  });

  it('is absent outside the APK', () => {
    expect(nativeBluetooth()).toBeNull();
  });

  it('connects, writes hex and feeds notifications and disconnects back', async () => {
    const { calls, listeners } = fakeBridge();
    const ble = nativeBluetooth()!;
    const device = await ble.requestDevice({ filters: [{ services: [0xffc0] }], optionalServices: [0xffc0] });
    expect(device.name).toBe('Spark LIVE BLE');
    expect(calls[0]).toEqual({ method: 'initialize', options: { androidNeverForLocation: true } });
    expect(calls[1].method).toBe('isEnabled');
    expect(calls[2].options).toEqual({ services: ['0000ffc0-0000-1000-8000-00805f9b34fb'] });

    const server = await device.gatt!.connect();
    expect(device.gatt!.connected).toBe(true);
    const service = await server.getPrimaryService(0xffc0);
    const write = await service.getCharacteristic(0xffc1);
    const notify = await service.getCharacteristic(0xffc2);

    await write.writeValueWithoutResponse(new Uint8Array([0xf0, 0x01, 0xf7]));
    expect(calls.at(-1)).toEqual({
      method: 'writeWithoutResponse',
      options: { deviceId: 'AA:BB', service: fullUuid(0xffc0), characteristic: fullUuid(0xffc1), value: 'f001f7' },
    });

    const seen: number[][] = [];
    notify.addEventListener('characteristicvaluechanged', () => {
      const v = notify.value!;
      seen.push([...new Uint8Array(v.buffer, v.byteOffset, v.byteLength)]);
    });
    await notify.startNotifications();
    listeners.get(`notification|AA:BB|${fullUuid(0xffc0)}|${fullUuid(0xffc2)}`)!({ value: '0102ff' });
    expect(seen).toEqual([[0x01, 0x02, 0xff]]);

    let lost = false;
    device.addEventListener('gattserverdisconnected', () => (lost = true));
    listeners.get('disconnected|AA:BB')!(null);
    expect(lost).toBe(true);
    expect(device.gatt!.connected).toBe(false);
  });
});
