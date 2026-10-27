import { deviceName } from './push-reminders';

describe('deviceName', () => {
  it('names the device from the user agent', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (Linux; Android 15; SM-S921B)')).toBe('Android');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
  });
});
