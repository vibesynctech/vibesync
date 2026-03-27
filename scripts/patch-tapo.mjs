/**
 * Patches tp-link-tapo-connect's setHSL method to include color_temp:0.
 *
 * Bug: The library sends {hue, saturation, brightness} without color_temp:0.
 * Tapo L900 ignores hue/saturation when in color_temp mode — only brightness changes.
 * Fix: Include "color_temp": 0 so the device switches to color mode.
 *
 * Run automatically via "postinstall" in package.json.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const target = join(__dir, '..', 'node_modules', 'tp-link-tapo-connect', 'dist', 'tapo-device.js');

const BUGGY = `                        setHSLRequest = {
                            "method": "set_device_info",
                            "params": {
                                "hue": normalisedHue,
                                "saturation": normalisedSat,
                                "brightness": normalisedLum
                            }
                        };`;

const FIXED = `                        setHSLRequest = {
                            "method": "set_device_info",
                            "params": {
                                "hue": normalisedHue,
                                "saturation": normalisedSat,
                                "brightness": normalisedLum,
                                "color_temp": 0
                            }
                        };`;

let src;
try {
  src = readFileSync(target, 'utf8');
} catch {
  console.warn('patch-tapo: library file not found, skipping patch.');
  process.exit(0);
}

if (src.includes('"color_temp": 0')) {
  console.log('patch-tapo: already patched, nothing to do.');
  process.exit(0);
}

if (!src.includes(BUGGY)) {
  console.warn('patch-tapo: source changed unexpectedly — patch may be outdated. Check manually.');
  process.exit(0);
}

writeFileSync(target, src.replace(BUGGY, FIXED), 'utf8');
console.log('patch-tapo: ✅ Applied color_temp:0 fix to setHSL.');
