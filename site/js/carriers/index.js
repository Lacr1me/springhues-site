// 载体注册表。将来新增载体的唯一入口：registerCarrier(type, carrier)。未知名称回退 shard。
import phone from './phone.js';
import win from './window.js';
import page from './page.js';
import shard from './shard.js';
import browser from './browser.js';

const registry = new Map([['phone', phone], ['window', win], ['page', page], ['shard', shard], ['browser', browser]]);
export function getCarrier(type) { return registry.get(type) ?? shard; }
export function registerCarrier(type, carrier) { registry.set(type, carrier); }
export function carrierFor(work, category) { return getCarrier(work.carrier || category.carrier); }
