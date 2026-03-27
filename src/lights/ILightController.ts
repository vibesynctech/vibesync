/**
 * Abstraction interface for smart light controllers.
 * Implementing this for any brand (Tapo, Yeelight, Hue, etc.) means
 * zero changes needed elsewhere in the extension.
 */
export interface ILightController {
  /** Connect to the device. Throws on failure. */
  connect(): Promise<void>;

  /**
   * Set a color using HSL values.
   * @param hue 0–360
   * @param saturation 0–100
   * @param brightness 10–100 (min 10 to avoid turning off accidentally)
   */
  setColor(hue: number, saturation: number, brightness: number): Promise<void>;

  /**
   * Set warm/cool white using a color temperature.
   * @param kelvin 2500–6500
   * @param brightness 10–100
   */
  setColorTemperature(kelvin: number, brightness?: number): Promise<void>;

  /** Set brightness without changing color. */
  setBrightness(brightness: number): Promise<void>;

  /** Turn light on or off. */
  setPower(on: boolean): Promise<void>;

  /** Whether the controller is connected and ready. */
  isConnected(): boolean;

  /** Clean disconnect. */
  disconnect(): void;
}
