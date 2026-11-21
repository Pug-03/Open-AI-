import { activeCity } from '@walkwe/config';
import { OpenMeteoCloud, PhotonGeocoder, type CloudCoverProvider, type GeocoderAdapter, type PlatformAdapter } from '@walkwe/core';
import { env } from './env.ts';
import { WebPlatform } from './platform/web.ts';
import { WorkerRoutingEngine } from './routing/WorkerRoutingEngine.ts';

// The one place adapters are chosen. Swapping Photon for Longdo, or the web
// platform for Capacitor, changes this file only.
export const geocoder: GeocoderAdapter = new PhotonGeocoder({ baseUrl: env.geocoderUrl, bounds: activeCity.bounds });
export const platform: PlatformAdapter = new WebPlatform();
export const routing = new WorkerRoutingEngine();
export const weather: CloudCoverProvider = new OpenMeteoCloud({ baseUrl: env.weatherUrl });
