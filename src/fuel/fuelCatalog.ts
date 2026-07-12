// ============================================================
// METEONEXUS - FUEL CATALOG
// ============================================================

export const FUEL_CATALOG = {
  "Shell": ["V-Power Racing", "V-Power Gasoline", "V-Power Diesel", "FuelSave Gasoline", "FuelSave Diesel"],
  "Petron": ["Blaze 100", "XCS", "Xtra Advance", "Turbo Diesel", "Diesel Max"],
  "Caltex": ["Platinum with Techron", "Silver with Techron", "Diesel with Techron D"],
  "Seaoil": ["Extreme 97", "Extreme 95", "Extreme U", "Exceed Diesel"],
  "Unioil": ["Euro 5 Premium 97", "Euro 5 Premium 95", "Euro 5 Unleaded 91", "Euro 5 Diesel"],
  "Cleanfuel": ["Premium 95", "Clean91", "Diesel", "AutoLPG"],
  "Flying V": ["Thunder Plus", "Thunder", "Unleaded", "Diesel"],
  "PTT": ["Blue Innovation 97", "Blue Innovation 95", "Blue Innovation 91", "Blue Diesel"],
  "Phoenix": ["Premium 98", "Premium 95", "Super Unleaded", "Diesel"]
} as const;

export const BRAND_LINKS = {
  "Shell": "https://find.shell.com/ph/fuel/locations/en_PH",
  "Petron": "https://www.petron.com/station-finder/",
  "Caltex": "https://www.caltex.com/ph/find-a-caltex-station.html",
  "Seaoil": "https://www.seaoil.com.ph/station-locator",
  "Unioil": "https://unioil.com/station-locator",
  "Cleanfuel": "https://www.cleanfuel.ph/stations/",
  "Flying V": "https://www.flyingv.com.ph/station-locator/",
  "PTT": "https://www.pttphilippines.com/station-locator/",
  "Phoenix": "https://www.phoenixfuels.ph/station-locator/"
} as const;

export const VARIANT_OSM_MAP: Record<string, string> = {
  "Blaze 100": "fuel:octane_100", "XCS": "fuel:octane_95", "Xtra Advance": "fuel:octane_91",
  "Turbo Diesel": "fuel:diesel", "Diesel Max": "fuel:diesel",
  "V-Power Racing": "fuel:octane_98", "V-Power Gasoline": "fuel:octane_95", "V-Power Diesel": "fuel:diesel",
  "FuelSave Gasoline": "fuel:octane_91", "FuelSave Diesel": "fuel:diesel",
  "Platinum with Techron": "fuel:octane_95", "Silver with Techron": "fuel:octane_91", "Diesel with Techron D": "fuel:diesel",
  "Extreme 97": "fuel:octane_97", "Extreme 95": "fuel:octane_95", "Extreme U": "fuel:octane_91", "Exceed Diesel": "fuel:diesel",
  "Euro 5 Premium 97": "fuel:octane_97", "Euro 5 Premium 95": "fuel:octane_95",
  "Euro 5 Unleaded 91": "fuel:octane_91", "Euro 5 Diesel": "fuel:diesel",
  "Premium 95": "fuel:octane_95", "Clean91": "fuel:octane_91", "Diesel": "fuel:diesel", "AutoLPG": "fuel:lpg",
  "Thunder Plus": "fuel:octane_95", "Thunder": "fuel:octane_91", "Unleaded": "fuel:octane_91",
  "Blue Innovation 97": "fuel:octane_97", "Blue Innovation 95": "fuel:octane_95",
  "Blue Innovation 91": "fuel:octane_91", "Blue Diesel": "fuel:diesel",
  "Premium 98": "fuel:octane_98", "Super Unleaded": "fuel:octane_91"
};