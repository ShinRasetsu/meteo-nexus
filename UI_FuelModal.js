/**
 * UI_FuelModal.js
 * Encapsulates the Fuel Preferences Modal, Overpass API Node Extraction,
 * Pitstop Routing logic, and Protected IndexedDB I/O boundaries.
 */
export class FuelModal {
    constructor(mountPointId) {
        this.mountPointId = mountPointId;
        this.storageKey = 'meteo_fuel_prefs';
        this.memoryConfig = { brand: 'Shell', variant: 'V-Power Racing', avoidTolls: false, avoidHighways: false, avoidFerries: false };
        this._isInitialized = false;
        
        this.FUEL_CATALOG = {
            "Shell": ["V-Power Racing", "V-Power Gasoline", "V-Power Diesel", "FuelSave Gasoline", "FuelSave Diesel"],
            "Petron": ["Blaze 100", "XCS", "Xtra Advance", "Turbo Diesel", "Diesel Max"],
            "Caltex": ["Platinum with Techron", "Silver with Techron", "Diesel with Techron D"],
            "Seaoil": ["Extreme 97", "Extreme 95", "Extreme U", "Exceed Diesel"]
        };

        this.DOM = {};
    }

    mount() {
        const container = document.getElementById(this.mountPointId);
        if (!container) return;

        container.innerHTML = `
            <h3 class="text-xl font-black text-brand-orange uppercase tracking-widest mb-4"><i class="fa-solid fa-gas-pump"></i> Fuel Parameters</h3>
            <div class="space-y-4 font-mono">
                <div>
                    <label class="block text-xs text-gray-500 mb-1 uppercase tracking-widest">Target Brand</label>
                    <select id="pref-brand" class="w-full bg-surface-800 border-2 border-surface-700 rounded-lg p-2 text-sm text-white focus:border-brand-orange outline-none transition-colors"></select>
                </div>
                <div>
                    <label class="block text-xs text-gray-500 mb-1 uppercase tracking-widest">Variant (Optional)</label>
                    <select id="pref-variant" class="w-full bg-surface-800 border-2 border-surface-700 rounded-lg p-2 text-sm text-white focus:border-brand-orange outline-none transition-colors"></select>
                </div>
                
                <div class="mt-4 pt-4 border-t border-surface-700 space-y-3">
                    <span class="block text-xs text-gray-500 mb-2 uppercase tracking-widest">Routing Options</span>
                    
                    <label class="flex items-center gap-3 cursor-pointer group">
                        <div class="relative">
                            <input type="checkbox" id="pref-toll" class="peer sr-only">
                            <div class="w-10 h-6 bg-surface-800 rounded-full border-2 border-surface-600 transition-colors group-hover:border-brand-orange peer-checked:bg-brand-orange peer-checked:border-brand-orange"></div>
                            <div class="absolute left-1 top-1 bg-gray-400 w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 peer-checked:bg-black"></div>
                        </div>
                        <span class="text-sm font-bold text-gray-300 uppercase tracking-widest">Avoid Tolls</span>
                    </label>
                    
                    <label class="flex items-center gap-3 cursor-pointer group">
                        <div class="relative">
                            <input type="checkbox" id="pref-highway" class="peer sr-only">
                            <div class="w-10 h-6 bg-surface-800 rounded-full border-2 border-surface-600 transition-colors group-hover:border-brand-orange peer-checked:bg-brand-orange peer-checked:border-brand-orange"></div>
                            <div class="absolute left-1 top-1 bg-gray-400 w-4 h-4 rounded-full transition-transform peer-checked:translate-x-4 peer-checked:bg-black"></div>
                        </div>
                        <span class="text-sm font-bold text-gray-300 uppercase tracking-widest">Avoid Highways</span>
                    </label>
                </div>
            </div>
            <div class="flex gap-3 justify-end mt-6">
                <button onclick="window.closeModal('fuel-settings-modal')" class="px-4 py-2 bg-surface-800 text-gray-300 font-bold rounded-lg hover:bg-surface-700 transition-colors uppercase tracking-widest text-sm">Close</button>
                <button id="save-fuel-btn" class="px-4 py-2 bg-brand-orange text-black font-black rounded-lg hover:bg-orange-500 transition-colors uppercase tracking-widest text-sm shadow-[0_0_15px_rgba(245,158,11,0.5)]">Save Config</button>
            </div>
        `;
        
        this.DOM = {
            brand: document.getElementById('pref-brand'),
            variant: document.getElementById('pref-variant'),
            toll: document.getElementById('pref-toll'),
            highway: document.getElementById('pref-highway'),
            save: document.getElementById('save-fuel-btn')
        };

        // Wire Event Listeners internally
        this.DOM.brand.addEventListener('change', (e) => {
            this.updateVariants(e.target.value);
        });

        this.DOM.save.addEventListener('click', () => {
            this.saveConfig({ 
                brand: this.DOM.brand.value, 
                variant: this.DOM.variant.value,
                avoidTolls: this.DOM.toll.checked,
                avoidHighways: this.DOM.highway.checked,
                avoidFerries: false // Preserved for API backward-compatibility
            });
            window.closeModal('fuel-settings-modal');
        });
    }

    updateVariants(selectedBrand) {
        if (!this.DOM.variant) return;
        this.DOM.variant.innerHTML = '';
        const variants = this.FUEL_CATALOG[selectedBrand] || ["Any"];
        variants.forEach(variant => {
            const opt = document.createElement('option');
            opt.value = variant;
            opt.textContent = variant;
            this.DOM.variant.appendChild(opt);
        });
    }

    async loadConfig() {
        if (this._isInitialized) return;

        try {
            if (window.localforage) {
                const stored = await Promise.race([
                    window.localforage.getItem(this.storageKey),
                    new Promise((_, r) => setTimeout(() => r(new Error('IDB timeout')), 2000))
                ]).catch(() => null);

                if (stored) {
                    this.memoryConfig = { ...this.memoryConfig, ...stored };
                }
            }
        } catch (e) {
            console.warn("Storage fetch failed. Using hard defaults.", e);
        }

        // Apply loaded values to DOM
        if (this.DOM.brand) {
            Object.keys(this.FUEL_CATALOG).forEach(brand => {
                const opt = document.createElement('option');
                opt.value = brand;
                opt.textContent = brand;
                this.DOM.brand.appendChild(opt);
            });
            this.DOM.brand.value = this.FUEL_CATALOG[this.memoryConfig.brand] ? this.memoryConfig.brand : 'Shell';
            
            this.updateVariants(this.DOM.brand.value);
            if (Array.from(this.DOM.variant.options).some(opt => opt.value === this.memoryConfig.variant)) {
                this.DOM.variant.value = this.memoryConfig.variant;
            }

            this.DOM.toll.checked = this.memoryConfig.avoidTolls;
            this.DOM.highway.checked = this.memoryConfig.avoidHighways;
        }

        this._isInitialized = true;
    }

    async saveConfig(conf) {
        this.memoryConfig = conf;
        try {
            if (window.localforage) {
                await window.localforage.setItem(this.storageKey, conf);
            }
            if (window.DOM && window.DOM.statusEl) {
                window.updateText(window.DOM.statusEl, "FUEL CONFIG SAVED");
                window.updateClass(window.DOM.statusEl, "text-xs md:text-sm font-bold text-brand-orange uppercase tracking-widest bg-brand-orange/10 px-2 py-1 md:px-3 md:py-1.5 rounded-lg border-2 border-brand-orange/50 whitespace-nowrap");
            }
        } catch(e) {
            console.error("Config save failed", e);
        }
    }
}