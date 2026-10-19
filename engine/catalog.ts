/**
 * Static reference data for the initial scope defined in the plan:
 * India as the reference market plus a small set of trade partners.
 *
 * All values are SIMULATED calibration inputs that approximate publicly
 * reported 2025-26 ranges. They are not live data and carry no source feed.
 */
import type {
  CommodityId,
  Competitor,
  Country,
  CountryCode,
  CountryEconomy,
  IndustryDef,
  IndustryId,
  MaterialDef,
  Policy,
  ProductTemplate,
  RouteDef,
  SegmentDef,
  SupplierDef,
} from './types';
import { rupees } from './money';

export const DATA_PROVENANCE =
  'Simulated calibration values approximating publicly reported 2025-26 ranges. Not live data; no external feed is connected.';

export const COUNTRIES: Record<CountryCode, Country> = {
  IN: { code: 'IN', name: 'India', currency: 'INR', region: 'South Asia', map: { x: 719, y: 189 }, ports: ['Chennai', 'Nhava Sheva (Mumbai)'] },
  CN: { code: 'CN', name: 'China', currency: 'CNY', region: 'East Asia', map: { x: 790, y: 155 }, ports: ['Shenzhen', 'Guangzhou'] },
  US: { code: 'US', name: 'United States', currency: 'USD', region: 'North America', map: { x: 235, y: 145 }, ports: ['Newark'] },
  DE: { code: 'DE', name: 'Germany', currency: 'EUR', region: 'Europe', map: { x: 528, y: 106 }, ports: ['Hamburg'] },
  AE: { code: 'AE', name: 'United Arab Emirates', currency: 'AED', region: 'Middle East', map: { x: 653, y: 181 }, ports: ['Jebel Ali'] },
  VN: { code: 'VN', name: 'Vietnam', currency: 'VND', region: 'Southeast Asia', map: { x: 796, y: 212 }, ports: ['Ho Chi Minh City'] },
};

export const COUNTRY_CODES = Object.keys(COUNTRIES) as CountryCode[];

export const INITIAL_ECONOMY: Record<CountryCode, CountryEconomy> = {
  IN: { code: 'IN', gdpGrowth: 6.5, inflation: 4.5, policyRate: 6.5, fxPerINR: 1, stability: 72, consumerConfidence: 100, relationsWithIndia: 100 },
  CN: { code: 'CN', gdpGrowth: 4.8, inflation: 1.0, policyRate: 3.45, fxPerINR: 0.085, stability: 75, consumerConfidence: 98, relationsWithIndia: -20 },
  US: { code: 'US', gdpGrowth: 2.0, inflation: 3.0, policyRate: 4.5, fxPerINR: 0.0118, stability: 70, consumerConfidence: 101, relationsWithIndia: 55 },
  DE: { code: 'DE', gdpGrowth: 0.8, inflation: 2.2, policyRate: 3.0, fxPerINR: 0.0108, stability: 80, consumerConfidence: 96, relationsWithIndia: 50 },
  AE: { code: 'AE', gdpGrowth: 3.8, inflation: 2.3, policyRate: 4.5, fxPerINR: 0.0434, stability: 82, consumerConfidence: 104, relationsWithIndia: 70 },
  VN: { code: 'VN', gdpGrowth: 6.2, inflation: 3.5, policyRate: 4.5, fxPerINR: 300, stability: 74, consumerConfidence: 102, relationsWithIndia: 45 },
};

/** long-run anchors the mean-reverting economy drifts back towards */
export const ECONOMY_ANCHORS = INITIAL_ECONOMY;

export const COMMODITIES: Record<CommodityId, { name: string; volatility: number }> = {
  semiconductors: { name: 'Semiconductors', volatility: 0.025 },
  lithium: { name: 'Lithium', volatility: 0.05 },
  copper: { name: 'Copper', volatility: 0.03 },
  steel: { name: 'Steel', volatility: 0.025 },
  polymers: { name: 'Polymers', volatility: 0.02 },
  grains: { name: 'Millets & grains', volatility: 0.03 },
  dairy: { name: 'Dairy', volatility: 0.015 },
  packaging: { name: 'Packaging', volatility: 0.015 },
};

export const MATERIALS: Record<string, MaterialDef> = {
  chipset: { id: 'chipset', name: 'SoC chipset', unit: 'pcs', category: 'electronics', basePrice: rupees(5500), commodity: 'semiconductors', volume: 0.01 },
  display: { id: 'display', name: 'Display panel', unit: 'pcs', category: 'electronics', basePrice: rupees(3200), commodity: 'semiconductors', volume: 0.05 },
  li_cell: { id: 'li_cell', name: 'Lithium-ion cell', unit: 'cells', category: 'energy_storage', basePrice: rupees(550), commodity: 'lithium', volume: 0.02 },
  polymer: { id: 'polymer', name: 'Polymer housing / resin', unit: 'kg', category: 'chemicals', basePrice: rupees(120), commodity: 'polymers', volume: 0.05 },
  copper: { id: 'copper', name: 'Copper wire & windings', unit: 'kg', category: 'metals', basePrice: rupees(700), commodity: 'copper', volume: 0.03 },
  steel: { id: 'steel', name: 'Steel sheet & tube', unit: 'kg', category: 'metals', basePrice: rupees(75), commodity: 'steel', volume: 0.04 },
  packaging: { id: 'packaging', name: 'Retail packaging box', unit: 'pcs', category: 'packaging', basePrice: rupees(15), commodity: 'packaging', volume: 0.02 },
  millet: { id: 'millet', name: 'Millet grain (kambu, ragi)', unit: 'kg', category: 'agri', basePrice: rupees(45), commodity: 'grains', volume: 0.02 },
  dairy: { id: 'dairy', name: 'Curd & buttermilk base', unit: 'kg', category: 'agri', basePrice: rupees(60), commodity: 'dairy', volume: 0.02 },
  pet_bottle: { id: 'pet_bottle', name: 'Food-grade PET bottle', unit: 'pcs', category: 'packaging', basePrice: rupees(6), commodity: 'polymers', volume: 0.005 },
};

export const ROUTES: Record<string, RouteDef> = {
  'CN-CHE': { id: 'CN-CHE', name: 'Shenzhen → Chennai (sea)', from: 'CN', to: 'IN', fromPort: 'Shenzhen', toPort: 'Chennai', mode: 'sea', freightRate: 0.035, path: [{ x: 817, y: 188 }, { x: 800, y: 222 }, { x: 788, y: 246 }, { x: 760, y: 238 }, { x: 723, y: 214 }] },
  'VN-CHE': { id: 'VN-CHE', name: 'Ho Chi Minh City → Chennai (sea)', from: 'VN', to: 'IN', fromPort: 'Ho Chi Minh City', toPort: 'Chennai', mode: 'sea', freightRate: 0.03, path: [{ x: 796, y: 220 }, { x: 788, y: 246 }, { x: 760, y: 238 }, { x: 723, y: 214 }] },
  'DE-MUM': { id: 'DE-MUM', name: 'Hamburg → Nhava Sheva via Suez (sea)', from: 'DE', to: 'IN', fromPort: 'Hamburg', toPort: 'Nhava Sheva', mode: 'sea', freightRate: 0.05, path: [{ x: 528, y: 101 }, { x: 500, y: 118 }, { x: 484, y: 150 }, { x: 560, y: 160 }, { x: 590, y: 167 }, { x: 620, y: 215 }, { x: 702, y: 197 }] },
  'US-MUM': { id: 'US-MUM', name: 'Newark → Nhava Sheva via Suez (sea)', from: 'US', to: 'IN', fromPort: 'Newark', toPort: 'Nhava Sheva', mode: 'sea', freightRate: 0.06, path: [{ x: 294, y: 137 }, { x: 400, y: 145 }, { x: 484, y: 150 }, { x: 590, y: 167 }, { x: 620, y: 215 }, { x: 702, y: 197 }] },
  'AE-MUM': { id: 'AE-MUM', name: 'Jebel Ali → Nhava Sheva (sea)', from: 'AE', to: 'IN', fromPort: 'Jebel Ali', toPort: 'Nhava Sheva', mode: 'sea', freightRate: 0.02, path: [{ x: 653, y: 181 }, { x: 675, y: 192 }, { x: 702, y: 197 }] },
  'IN-ROAD': { id: 'IN-ROAD', name: 'Domestic road freight', from: 'IN', to: 'IN', fromPort: 'Pune / Madurai', toPort: 'Factory gate', mode: 'road', freightRate: 0.015, path: [{ x: 705, y: 198 }, { x: 716, y: 210 }, { x: 723, y: 214 }] },
};

/** outbound export lanes reuse the inbound route geometry */
export const EXPORT_ROUTE: Partial<Record<CountryCode, string>> = { AE: 'AE-MUM', DE: 'DE-MUM', US: 'US-MUM', VN: 'VN-CHE', CN: 'CN-CHE' };

export const SUPPLIERS: Record<string, SupplierDef> = {
  s_shenzhen: { id: 's_shenzhen', name: 'Shenzhen MicroSemi Ltd', country: 'CN', materials: ['chipset', 'display'], priceFactor: 0.92, reliability: 0.9, quality: 74, leadTime: 1, capacityPerMonth: 60000, paymentTermsMonths: 1, routeId: 'CN-CHE' },
  s_guangzhou: { id: 's_guangzhou', name: 'Guangzhou Cell Energy', country: 'CN', materials: ['li_cell'], priceFactor: 0.88, reliability: 0.88, quality: 72, leadTime: 1, capacityPerMonth: 900000, paymentTermsMonths: 1, routeId: 'CN-CHE' },
  s_hanoi: { id: 's_hanoi', name: 'Saigon Display & Assembly', country: 'VN', materials: ['display', 'chipset'], priceFactor: 0.97, reliability: 0.93, quality: 71, leadTime: 1, capacityPerMonth: 40000, paymentTermsMonths: 1, routeId: 'VN-CHE' },
  s_saigon_pack: { id: 's_saigon_pack', name: 'Saigon Packaging JSC', country: 'VN', materials: ['packaging', 'pet_bottle'], priceFactor: 0.85, reliability: 0.9, quality: 66, leadTime: 1, capacityPerMonth: 2000000, paymentTermsMonths: 1, routeId: 'VN-CHE' },
  s_stuttgart: { id: 's_stuttgart', name: 'Stuttgart Batterie GmbH', country: 'DE', materials: ['li_cell', 'chipset'], priceFactor: 1.18, reliability: 0.97, quality: 88, leadTime: 2, capacityPerMonth: 400000, paymentTermsMonths: 1, routeId: 'DE-MUM' },
  s_texas: { id: 's_texas', name: 'Lone Star Semiconductor Inc', country: 'US', materials: ['chipset'], priceFactor: 1.08, reliability: 0.95, quality: 90, leadTime: 2, capacityPerMonth: 50000, paymentTermsMonths: 1, routeId: 'US-MUM' },
  s_gulf: { id: 's_gulf', name: 'Gulf Cell & Metals Trading', country: 'AE', materials: ['li_cell', 'copper', 'steel'], priceFactor: 1.03, reliability: 0.92, quality: 70, leadTime: 1, capacityPerMonth: 500000, paymentTermsMonths: 0, routeId: 'AE-MUM' },
  s_bengaluru: { id: 's_bengaluru', name: 'Bengaluru Silicon Works', country: 'IN', materials: ['chipset', 'display'], priceFactor: 1.14, reliability: 0.97, quality: 77, leadTime: 0, capacityPerMonth: 15000, paymentTermsMonths: 1, routeId: 'IN-ROAD' },
  s_pune: { id: 's_pune', name: 'Pune Steel & Alloys', country: 'IN', materials: ['steel', 'copper'], priceFactor: 1.0, reliability: 0.96, quality: 70, leadTime: 0, capacityPerMonth: 800000, paymentTermsMonths: 1, routeId: 'IN-ROAD' },
  s_chennai_poly: { id: 's_chennai_poly', name: 'Chennai Polymers', country: 'IN', materials: ['polymer', 'packaging', 'pet_bottle'], priceFactor: 1.0, reliability: 0.97, quality: 68, leadTime: 0, capacityPerMonth: 3000000, paymentTermsMonths: 1, routeId: 'IN-ROAD' },
  s_madurai: { id: 's_madurai', name: 'Madurai Millet Collective', country: 'IN', materials: ['millet'], priceFactor: 1.0, reliability: 0.9, quality: 78, leadTime: 0, capacityPerMonth: 200000, paymentTermsMonths: 0, routeId: 'IN-ROAD' },
  s_kongu: { id: 's_kongu', name: 'Kongu Dairy Co-operative', country: 'IN', materials: ['dairy'], priceFactor: 1.0, reliability: 0.94, quality: 74, leadTime: 0, capacityPerMonth: 150000, paymentTermsMonths: 0, routeId: 'IN-ROAD' },
};

/** Import tariff into India by origin and material category (fraction). Approximations. */
export const BASE_TARIFFS: Record<CountryCode, Record<string, number>> = {
  IN: { electronics: 0, energy_storage: 0, chemicals: 0, metals: 0, packaging: 0, agri: 0 },
  CN: { electronics: 0.2, energy_storage: 0.2, chemicals: 0.1, metals: 0.15, packaging: 0.1, agri: 0.3 },
  VN: { electronics: 0.1, energy_storage: 0.1, chemicals: 0.075, metals: 0.1, packaging: 0.075, agri: 0.3 },
  US: { electronics: 0.15, energy_storage: 0.15, chemicals: 0.1, metals: 0.1, packaging: 0.1, agri: 0.3 },
  DE: { electronics: 0.15, energy_storage: 0.15, chemicals: 0.1, metals: 0.1, packaging: 0.1, agri: 0.3 },
  AE: { electronics: 0.05, energy_storage: 0.05, chemicals: 0.05, metals: 0, packaging: 0.05, agri: 0.1 },
};

/** Tariff applied by destination markets on Indian exports (fraction). Approximations. */
export const BASE_EXPORT_TARIFFS: Partial<Record<CountryCode, number>> = { AE: 0.05, US: 0.1, DE: 0.08, VN: 0.1, CN: 0.15 };

const flat = (n: number) => Array(12).fill(n) as number[];

export const SEGMENTS: Record<string, SegmentDef> = {
  smartphone_mid: { id: 'smartphone_mid', industry: 'electronics', name: 'Smartphones · mid-range', baseDemand: 42000, referencePrice: rupees(14000), priceElasticity: 1.8, qualityWeight: 1.2, brandWeight: 1.0, seasonality: [0.9, 0.85, 0.95, 0.95, 1.0, 0.95, 0.95, 1.0, 1.1, 1.35, 1.15, 0.95], exportDemand: { AE: 5000, VN: 3500 } },
  wireless_audio: { id: 'wireless_audio', industry: 'electronics', name: 'Wireless earbuds', baseDemand: 85000, referencePrice: rupees(1800), priceElasticity: 2.2, qualityWeight: 1.0, brandWeight: 1.2, seasonality: [0.95, 0.9, 0.95, 1.0, 1.0, 0.95, 0.95, 1.0, 1.05, 1.3, 1.1, 0.95], exportDemand: { AE: 9000, US: 6000 } },
  e_scooter: { id: 'e_scooter', industry: 'ev', name: 'Electric scooters', baseDemand: 9500, referencePrice: rupees(95000), priceElasticity: 1.6, qualityWeight: 1.4, brandWeight: 0.9, seasonality: [0.95, 0.95, 1.05, 1.0, 0.95, 0.85, 0.85, 0.95, 1.05, 1.25, 1.15, 1.0], exportDemand: { AE: 900, DE: 500 } },
  ebike: { id: 'ebike', industry: 'ev', name: 'E-bicycles', baseDemand: 7000, referencePrice: rupees(38000), priceElasticity: 1.9, qualityWeight: 1.1, brandWeight: 0.8, seasonality: [0.9, 0.95, 1.05, 1.1, 1.05, 0.85, 0.85, 0.9, 1.0, 1.15, 1.1, 1.0], exportDemand: { DE: 1200, US: 800 } },
  millet_beverage: { id: 'millet_beverage', industry: 'food', name: 'Millet beverages (koozh)', baseDemand: 900000, referencePrice: rupees(40), priceElasticity: 1.5, qualityWeight: 1.3, brandWeight: 1.1, seasonality: [0.8, 0.9, 1.15, 1.35, 1.4, 1.1, 0.9, 0.9, 0.95, 0.95, 0.85, 0.8], exportDemand: { AE: 90000, US: 60000 } },
  ready_meals: { id: 'ready_meals', industry: 'food', name: 'Millet ready meals', baseDemand: 420000, referencePrice: rupees(90), priceElasticity: 1.7, qualityWeight: 1.2, brandWeight: 1.0, seasonality: flat(1), exportDemand: { AE: 40000, US: 30000 } },
};

export const PRODUCT_TEMPLATES: Record<string, ProductTemplate> = {
  phone_a1: { id: 'phone_a1', industry: 'electronics', name: 'A1 Smartphone', segmentId: 'smartphone_mid', bom: [{ materialId: 'chipset', qty: 1 }, { materialId: 'display', qty: 1 }, { materialId: 'li_cell', qty: 2 }, { materialId: 'polymer', qty: 1 }, { materialId: 'packaging', qty: 1 }], laborHours: 2.5, machineHours: 0.4, energyKwh: 8, baseQuality: 62, referencePrice: rupees(14000), lineCapacity: 6000, unlockedByDefault: true, volume: 0.1, description: 'Mid-range 5G handset assembled from imported chipset and display.' },
  phone_pro: { id: 'phone_pro', industry: 'electronics', name: 'Pro Smartphone', segmentId: 'smartphone_mid', bom: [{ materialId: 'chipset', qty: 1 }, { materialId: 'display', qty: 1 }, { materialId: 'li_cell', qty: 3 }, { materialId: 'polymer', qty: 1 }, { materialId: 'copper', qty: 1 }, { materialId: 'packaging', qty: 1 }], laborHours: 3, machineHours: 0.5, energyKwh: 10, baseQuality: 78, referencePrice: rupees(19500), lineCapacity: 5000, unlockedByDefault: false, volume: 0.1, description: 'Premium handset with larger battery and improved thermal design (R&D unlock).' },
  earbuds: { id: 'earbuds', industry: 'electronics', name: 'Pulse Buds', segmentId: 'wireless_audio', bom: [{ materialId: 'chipset', qty: 0.2 }, { materialId: 'li_cell', qty: 0.5 }, { materialId: 'polymer', qty: 0.3 }, { materialId: 'packaging', qty: 1 }], laborHours: 0.5, machineHours: 0.08, energyKwh: 1.5, baseQuality: 60, referencePrice: rupees(1800), lineCapacity: 20000, unlockedByDefault: true, volume: 0.03, description: 'True-wireless earbuds sharing the phone supply base.' },
  scooter_s1: { id: 'scooter_s1', industry: 'ev', name: 'S1 E-Scooter', segmentId: 'e_scooter', bom: [{ materialId: 'li_cell', qty: 60 }, { materialId: 'steel', qty: 40 }, { materialId: 'copper', qty: 8 }, { materialId: 'chipset', qty: 1 }, { materialId: 'polymer', qty: 15 }, { materialId: 'packaging', qty: 1 }], laborHours: 18, machineHours: 3, energyKwh: 120, baseQuality: 60, referencePrice: rupees(95000), lineCapacity: 900, unlockedByDefault: true, volume: 2.5, description: 'Urban electric scooter with 3 kWh battery pack.' },
  ebike_city: { id: 'ebike_city', industry: 'ev', name: 'City E-Bike', segmentId: 'ebike', bom: [{ materialId: 'li_cell', qty: 20 }, { materialId: 'steel', qty: 14 }, { materialId: 'copper', qty: 2 }, { materialId: 'chipset', qty: 0.5 }, { materialId: 'polymer', qty: 4 }, { materialId: 'packaging', qty: 1 }], laborHours: 8, machineHours: 1.2, energyKwh: 45, baseQuality: 58, referencePrice: rupees(38000), lineCapacity: 1500, unlockedByDefault: true, volume: 1.5, description: 'Pedal-assist commuter bicycle.' },
  scooter_x: { id: 'scooter_x', industry: 'ev', name: 'X Long-Range Scooter', segmentId: 'e_scooter', bom: [{ materialId: 'li_cell', qty: 80 }, { materialId: 'steel', qty: 38 }, { materialId: 'copper', qty: 9 }, { materialId: 'chipset', qty: 1 }, { materialId: 'polymer', qty: 14 }, { materialId: 'packaging', qty: 1 }], laborHours: 20, machineHours: 3.2, energyKwh: 130, baseQuality: 78, referencePrice: rupees(125000), lineCapacity: 800, unlockedByDefault: false, volume: 2.6, description: 'Long-range scooter with 4 kWh pack (R&D unlock).' },
  koozh_classic: { id: 'koozh_classic', industry: 'food', name: 'Kambu Koozh 250 ml', segmentId: 'millet_beverage', bom: [{ materialId: 'millet', qty: 0.08 }, { materialId: 'dairy', qty: 0.05 }, { materialId: 'pet_bottle', qty: 1 }, { materialId: 'packaging', qty: 0.05 }], laborHours: 0.01, machineHours: 0.002, energyKwh: 0.05, baseQuality: 65, referencePrice: rupees(40), lineCapacity: 300000, unlockedByDefault: true, volume: 0.004, description: 'Fermented pearl-millet drink with buttermilk, chilled.' },
  meal_bowl: { id: 'meal_bowl', industry: 'food', name: 'Millet Meal Bowl', segmentId: 'ready_meals', bom: [{ materialId: 'millet', qty: 0.15 }, { materialId: 'dairy', qty: 0.08 }, { materialId: 'packaging', qty: 1 }], laborHours: 0.03, machineHours: 0.004, energyKwh: 0.12, baseQuality: 62, referencePrice: rupees(90), lineCapacity: 120000, unlockedByDefault: true, volume: 0.01, description: 'Ready-to-eat millet bowl with curd.' },
  koozh_premium: { id: 'koozh_premium', industry: 'food', name: 'Karuppu Kavuni Koozh', segmentId: 'millet_beverage', bom: [{ materialId: 'millet', qty: 0.1 }, { materialId: 'dairy', qty: 0.06 }, { materialId: 'pet_bottle', qty: 1 }, { materialId: 'packaging', qty: 0.05 }], laborHours: 0.012, machineHours: 0.002, energyKwh: 0.06, baseQuality: 80, referencePrice: rupees(55), lineCapacity: 250000, unlockedByDefault: false, volume: 0.004, description: 'Premium black-rice and millet koozh (R&D unlock).' },
};

export const INDUSTRIES: Record<IndustryId, IndustryDef> = {
  electronics: { id: 'electronics', name: 'Consumer Electronics', description: 'Smartphones and audio. Import-heavy bill of materials; chips and displays drive cost and disruption exposure.', segments: ['smartphone_mid', 'wireless_audio'], startingProducts: ['phone_a1', 'earbuds'], regulated: ['bis_cert', 'epr_levy'] },
  ev: { id: 'ev', name: 'Electric Mobility', description: 'E-scooters and e-bikes. Battery cells dominate cost; lithium and energy prices matter.', segments: ['e_scooter', 'ebike'], startingProducts: ['scooter_s1', 'ebike_city'], regulated: ['battery_safety', 'epr_levy'] },
  food: { id: 'food', name: 'Food & Beverage', description: 'Millet beverages and ready meals. Domestic agri inputs, high volume, seasonal demand.', segments: ['millet_beverage', 'ready_meals'], startingProducts: ['koozh_classic', 'meal_bowl'], regulated: ['fssai_label'] },
};

/** typical starting team structure, salary in rupees per month per head */
export const STARTING_TEAMS: Record<IndustryId, { department: 'production' | 'rnd' | 'sales_marketing' | 'operations' | 'admin'; role: string; headcount: number; salary: number; skill: number }[]> = {
  electronics: [
    { department: 'production', role: 'Assembly technicians', headcount: 90, salary: 22000, skill: 58 },
    { department: 'rnd', role: 'Hardware engineers', headcount: 8, salary: 95000, skill: 65 },
    { department: 'sales_marketing', role: 'Sales & marketing', headcount: 12, salary: 48000, skill: 60 },
    { department: 'operations', role: 'Supply chain & logistics', headcount: 8, salary: 40000, skill: 60 },
    { department: 'admin', role: 'Finance & administration', headcount: 6, salary: 60000, skill: 62 },
  ],
  ev: [
    { department: 'production', role: 'Assembly technicians', headcount: 110, salary: 24000, skill: 56 },
    { department: 'rnd', role: 'EV engineers', headcount: 10, salary: 100000, skill: 64 },
    { department: 'sales_marketing', role: 'Dealer sales & marketing', headcount: 14, salary: 45000, skill: 58 },
    { department: 'operations', role: 'Supply chain & logistics', headcount: 10, salary: 40000, skill: 60 },
    { department: 'admin', role: 'Finance & administration', headcount: 6, salary: 60000, skill: 62 },
  ],
  food: [
    { department: 'production', role: 'Production operators', headcount: 40, salary: 18000, skill: 60 },
    { department: 'rnd', role: 'Food technologists', headcount: 4, salary: 65000, skill: 62 },
    { department: 'sales_marketing', role: 'Distribution & marketing', headcount: 16, salary: 32000, skill: 58 },
    { department: 'operations', role: 'Cold chain & logistics', headcount: 12, salary: 26000, skill: 60 },
    { department: 'admin', role: 'Finance & administration', headcount: 5, salary: 50000, skill: 62 },
  ],
};

export const FACILITY_SPECS = {
  hq: { label: 'Headquarters', buildCost: rupees(0), leaseMonthly: rupees(250000), life: 0, capacity: 0, buildMonths: 0 },
  factory: { label: 'Factory', buildCost: rupees(25000000), leaseMonthly: rupees(400000), life: 120, capacity: 900000, buildMonths: 2 },
  warehouse: { label: 'Warehouse', buildCost: rupees(6000000), leaseMonthly: rupees(150000), life: 120, capacity: 3000, buildMonths: 1 },
  rnd_lab: { label: 'R&D Lab', buildCost: rupees(6000000), leaseMonthly: rupees(120000), life: 96, capacity: 0, buildMonths: 2 },
  logistics_hub: { label: 'Logistics Hub', buildCost: rupees(8000000), leaseMonthly: rupees(180000), life: 120, capacity: 0, buildMonths: 2 },
} as const;

/** facility cost scaling by industry (food plants are lighter, EV plants heavier) */
export const INDUSTRY_FACILITY_FACTOR: Record<IndustryId, number> = { electronics: 1, ev: 1.2, food: 0.45 };

export const CITIES: { name: string; state: string; costFactor: number; port: string }[] = [
  { name: 'Chennai', state: 'Tamil Nadu', costFactor: 1.0, port: 'Chennai' },
  { name: 'Pune', state: 'Maharashtra', costFactor: 1.05, port: 'Nhava Sheva (Mumbai)' },
  { name: 'Bengaluru', state: 'Karnataka', costFactor: 1.15, port: 'Chennai' },
  { name: 'Ahmedabad', state: 'Gujarat', costFactor: 0.95, port: 'Nhava Sheva (Mumbai)' },
  { name: 'Coimbatore', state: 'Tamil Nadu', costFactor: 0.9, port: 'Chennai' },
];

export function initialCompetitors(): Competitor[] {
  return [
    { id: 'cmp_nova', name: 'Nova Mobile', country: 'CN', industry: 'electronics', awareness: 62, posture: 'aggressive', recentMoves: [], offers: [
      { segmentId: 'smartphone_mid', name: 'Nova N5', price: rupees(12900), quality: 63, capacity: 16000, lastSold: 0 },
      { segmentId: 'wireless_audio', name: 'Nova Buds', price: rupees(1500), quality: 58, capacity: 30000, lastSold: 0 },
    ] },
    { id: 'cmp_kairo', name: 'Kairo Electronics', country: 'IN', industry: 'electronics', awareness: 55, posture: 'balanced', recentMoves: [], offers: [
      { segmentId: 'smartphone_mid', name: 'Kairo K7', price: rupees(14500), quality: 68, capacity: 12000, lastSold: 0 },
      { segmentId: 'wireless_audio', name: 'Kairo Air', price: rupees(1900), quality: 62, capacity: 22000, lastSold: 0 },
    ] },
    { id: 'cmp_soundforge', name: 'SoundForge', country: 'US', industry: 'electronics', awareness: 70, posture: 'premium', recentMoves: [], offers: [
      { segmentId: 'wireless_audio', name: 'SoundForge Pro', price: rupees(2700), quality: 82, capacity: 15000, lastSold: 0 },
    ] },
    { id: 'cmp_zentro', name: 'Zentro Motors', country: 'IN', industry: 'ev', awareness: 58, posture: 'balanced', recentMoves: [], offers: [
      { segmentId: 'e_scooter', name: 'Zentro Z2', price: rupees(99000), quality: 68, capacity: 3200, lastSold: 0 },
      { segmentId: 'ebike', name: 'Zentro City', price: rupees(36000), quality: 62, capacity: 2400, lastSold: 0 },
    ] },
    { id: 'cmp_hanwei', name: 'Hanwei EV', country: 'CN', industry: 'ev', awareness: 45, posture: 'aggressive', recentMoves: [], offers: [
      { segmentId: 'e_scooter', name: 'Hanwei H1', price: rupees(82000), quality: 58, capacity: 3800, lastSold: 0 },
    ] },
    { id: 'cmp_velora', name: 'Velora Bikes', country: 'DE', industry: 'ev', awareness: 50, posture: 'premium', recentMoves: [], offers: [
      { segmentId: 'ebike', name: 'Velora Trek', price: rupees(52000), quality: 82, capacity: 1200, lastSold: 0 },
    ] },
    { id: 'cmp_annapurna', name: 'Annapurna Foods', country: 'IN', industry: 'food', awareness: 60, posture: 'balanced', recentMoves: [], offers: [
      { segmentId: 'millet_beverage', name: 'Annapurna Ragi Malt', price: rupees(38), quality: 62, capacity: 330000, lastSold: 0 },
      { segmentId: 'ready_meals', name: 'Annapurna Bowl', price: rupees(85), quality: 64, capacity: 160000, lastSold: 0 },
    ] },
    { id: 'cmp_freshsip', name: 'FreshSip Beverages', country: 'IN', industry: 'food', awareness: 52, posture: 'aggressive', recentMoves: [], offers: [
      { segmentId: 'millet_beverage', name: 'FreshSip Millet Shake', price: rupees(32), quality: 55, capacity: 260000, lastSold: 0 },
    ] },
    { id: 'cmp_gulfgourmet', name: 'Gulf Gourmet', country: 'AE', industry: 'food', awareness: 48, posture: 'premium', recentMoves: [], offers: [
      { segmentId: 'ready_meals', name: 'Gulf Gourmet Grain Bowl', price: rupees(125), quality: 80, capacity: 70000, lastSold: 0 },
    ] },
  ];
}

export function initialPolicies(): Policy[] {
  return [
    { id: 'corp_tax', title: 'Corporate income tax (new regime)', jurisdiction: 'IN', industries: 'all', kind: 'tax', description: 'Flat 25% tax on monthly taxable profit, after carried-forward losses. Accrued monthly and paid at each quarter end.', announcedTick: 0, effectiveTick: 0, complianceCost: 0, perUnitLevy: 0, monthlyPenalty: 0, approximation: 'Approximates the ~25.17% effective rate under Section 115BAA; surcharge/cess and GST are not modeled.', status: 'in_force' },
    { id: 'bis_cert', title: 'BIS compulsory registration for electronics', jurisdiction: 'IN', industries: ['electronics'], kind: 'certification', description: 'Products in notified electronics categories must be registered and tested before sale.', announcedTick: 0, effectiveTick: 4, complianceCost: rupees(800000), perUnitLevy: 0, monthlyPenalty: rupees(250000), approximation: 'Testing and registration cost is a single simulated estimate per company.', status: 'announced' },
    { id: 'battery_safety', title: 'Traction battery safety standard', jurisdiction: 'IN', industries: ['ev'], kind: 'certification', description: 'Battery packs must pass enhanced thermal and BMS safety testing.', announcedTick: 0, effectiveTick: 3, complianceCost: rupees(1200000), perUnitLevy: 0, monthlyPenalty: rupees(400000), approximation: 'Based loosely on AIS-156 style requirements; cost is a simulated estimate.', status: 'announced' },
    { id: 'epr_levy', title: 'Extended producer responsibility (e-waste & batteries)', jurisdiction: 'IN', industries: ['electronics', 'ev'], kind: 'per_unit_levy', description: 'Producers fund collection and recycling through a per-unit levy on units sold in India.', announcedTick: 0, effectiveTick: 6, complianceCost: rupees(100000), perUnitLevy: rupees(25), monthlyPenalty: rupees(150000), approximation: 'Flat per-unit levy approximates EPR certificate purchase costs.', status: 'announced' },
    { id: 'fssai_label', title: 'FSSAI labelling & licensing update', jurisdiction: 'IN', industries: ['food'], kind: 'certification', description: 'Revised front-of-pack nutrition labels and license renewal for packaged foods.', announcedTick: 0, effectiveTick: 2, complianceCost: rupees(200000), perUnitLevy: 0, monthlyPenalty: rupees(50000), approximation: 'Relabelling and audit cost is a simulated estimate.', status: 'announced' },
  ];
}

export function marketWage(role: string, baseSalaryRupees: number, wageIndex: number): number {
  void role;
  return rupees(baseSalaryRupees) * (wageIndex / 100);
}

export const BASE_SALARY_BY_DEPT: Record<string, number> = {
  production: 22000,
  rnd: 90000,
  sales_marketing: 45000,
  operations: 38000,
  admin: 58000,
};

export const EMPLOYER_CONTRIBUTION_RATE = 0.13; // PF/ESI/gratuity provisioning approximation
export const CORPORATE_TAX_RATE = 0.25;
export const HOURS_PER_HEAD = 168;
