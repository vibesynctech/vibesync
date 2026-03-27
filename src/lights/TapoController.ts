import { loginDeviceByIp } from 'tp-link-tapo-connect';
import { ILightController } from './ILightController.js';
import { log, logError } from '../utils/logger.js';

type TapoDeviceHandle = Awaited<ReturnType<typeof loginDeviceByIp>>;

export class TapoController implements ILightController {
  private device: TapoDeviceHandle | null = null;
  private connected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly RECONNECT_DELAY_MS = 3000;
  // Command lock — prevents concurrent API calls that corrupt the Tapo session
  private commandLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly ip: string,
    private readonly email: string,
    private readonly password: string
  ) {}

  async connect(): Promise<void> {
    try {
      log(`Connecting to Tapo device at ${this.ip}...`);
      this.device = await loginDeviceByIp(this.email, this.password, this.ip);
      this.connected = true;
      log(`Connected to Tapo device at ${this.ip}`);
    } catch (err) {
      this.connected = false;
      this.device = null;
      throw new Error(`Failed to connect to Tapo at ${this.ip}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async setColor(hue: number, saturation: number, brightness: number): Promise<void> {
    return this.enqueue(async () => {
      const h = Math.round(Math.max(0, Math.min(360, hue)));
      const s = Math.round(Math.max(0, Math.min(100, saturation)));
      const b = Math.round(Math.max(10, Math.min(100, brightness)));
      await this.device!.setHSL(h, s, b);
    }, 'setColor');
  }

  async setColorTemperature(kelvin: number, brightness = 70): Promise<void> {
    return this.enqueue(async () => {
      const k = Math.round(Math.max(2500, Math.min(6500, kelvin)));
      const b = Math.round(Math.max(10, Math.min(100, brightness)));
      await this.device!.setColour(`${k}k`);
      await this.device!.setBrightness(b);
    }, 'setColorTemperature');
  }

  async setBrightness(brightness: number): Promise<void> {
    return this.enqueue(async () => {
      const b = Math.round(Math.max(10, Math.min(100, brightness)));
      await this.device!.setBrightness(b);
    }, 'setBrightness');
  }

  async setPower(on: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (on) {
        await this.device!.turnOn();
      } else {
        await this.device!.turnOff();
      }
    }, 'setPower');
  }

  /**
   * Serializes all commands through a single queue.
   * Prevents concurrent API calls that corrupt the Tapo KLAP session.
   */
  private enqueue(fn: () => Promise<void>, method: string): Promise<void> {
    if (!this.assertConnected()) return Promise.resolve();
    this.commandLock = this.commandLock.then(fn).catch((err) => {
      this.handleError(method, err);
    });
    return this.commandLock;
  }

  isConnected(): boolean {
    return this.connected;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connected = false;
    this.device = null;
    log('Tapo controller disconnected');
  }

  private assertConnected(): boolean {
    if (!this.connected || !this.device) {
      log('Tapo: not connected, skipping command. Will attempt reconnect...');
      this.scheduleReconnect();
      return false;
    }
    return true;
  }

  private handleError(method: string, err: unknown): void {
    logError(`Tapo.${method} failed`, err);
    // Mark as disconnected and schedule reconnect
    this.connected = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return; // Already scheduled
    log(`Scheduling Tapo reconnect in ${this.RECONNECT_DELAY_MS / 1000}s...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        // connect() already logs the error — schedule another attempt
        this.scheduleReconnect();
      }
    }, this.RECONNECT_DELAY_MS);
  }
}
