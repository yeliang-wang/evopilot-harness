/** Additive online profile. Native v0.3 standards remain unchanged. */
export * from '../vendor/compatibility/online/v1/online.mjs';
export {createPrometheusCollector,validatePrometheusConnection,readOnlineSecret} from './online-prometheus.js';
export type {PrometheusConnection} from './online-prometheus.js';
export {createAlertmanagerReceiver} from './online-alertmanager.js';
export type {AlertmanagerConnection} from './online-alertmanager.js';
export {inspectOnlineStandard} from './online-standard.js';
