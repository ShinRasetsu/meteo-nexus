/**
 * UI_WeatherChart.js
 * Encapsulates the Chart.js instance for multi-model weather telemetry, 
 * solar irradiance, and UV index forecasting.
 */
export class WeatherChart {
    constructor(containerId) {
        this.containerId = containerId;
        this.chartWrapper = null;
        this.chartInstance = null;
        
        // Internal Theme Colors (Fallback for extracted global constants)
        this.theme = {
            orange: '#f59e0b',
            purple: '#a855f7',
            blue: '#3b82f6',
            teal: '#14b8a6',
            warning: '#eab308'
        };
    }

    /**
     * Injects the Canvas element into the DOM.
     */
    mount() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`WeatherChart: Container #${this.containerId} not found.`);
            return;
        }

        this.chartWrapper = document.createElement('div');
        this.chartWrapper.className = "w-full h-full min-h-[250px] relative";
        this.chartWrapper.innerHTML = `<canvas id="mainChart" class="w-full h-full"></canvas>`;
        
        container.appendChild(this.chartWrapper);
    }

    /**
     * Updates or initializes the Chart.js instance with new telemetry.
     * Utilizes array splicing to update data in-place, preventing memory fragmentation.
     */
    update(labels, rainData, solarData, uvData, hourlyAgreement) {
        const tc = this.theme;
        
        if (this.chartInstance) {
            // Fixed Memory Fragmentation vulnerability: Using splice to reassign rather than dynamically expanding length property limits 
            this.chartInstance.data.labels.splice(0, this.chartInstance.data.labels.length, ...labels);
            this.chartInstance.data.datasets[0].data.splice(0, this.chartInstance.data.datasets[0].data.length, ...solarData);
            this.chartInstance.data.datasets[1].data.splice(0, this.chartInstance.data.datasets[1].data.length, ...uvData);
            this.chartInstance.data.datasets[2].data.splice(0, this.chartInstance.data.datasets[2].data.length, ...rainData.eu);
            this.chartInstance.data.datasets[3].data.splice(0, this.chartInstance.data.datasets[3].data.length, ...rainData.us);
            this.chartInstance.data.datasets[4].data.splice(0, this.chartInstance.data.datasets[4].data.length, ...rainData.de);
            this.chartInstance.data.datasets[5].data.splice(0, this.chartInstance.data.datasets[5].data.length, ...rainData.jp);
            
            // Deep-bind the reference object to prevent closure memory leak and stale closures
            this.chartInstance.hourlyAgreementRef = hourlyAgreement;
            this.chartInstance.update('none'); 
            return;
        }

        const canvas = document.getElementById('mainChart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        
        // Preserve context references for tooltips
        const chartRefContext = this;

        this.chartInstance = new Chart(ctx, {
            data: {
                labels: labels,
                datasets: [
                    { type: 'bar', label: 'Solar (W/m²)', data: solarData, backgroundColor: tc.orange + '40', borderColor: tc.orange, borderWidth: 2, categoryPercentage: 0.6, barPercentage: 0.8, order: 3, yAxisID: 'y_solar', grouped: true },
                    { type: 'bar', label: 'UV Index', data: uvData, backgroundColor: tc.purple + '40', borderColor: tc.purple, borderWidth: 2, categoryPercentage: 0.6, barPercentage: 0.8, order: 2, yAxisID: 'y_uv', grouped: true },
                    { type: 'line', label: 'ECMWF', data: rainData.eu, borderColor: tc.blue, backgroundColor: tc.blue + '33', fill: true, borderWidth: 3, tension: 0.3, pointRadius: 0, order: 1, yAxisID: 'y_rain' },
                    { type: 'line', label: 'GFS', data: rainData.us, borderColor: tc.teal, backgroundColor: tc.teal + '33', fill: true, borderDash: [6,6], borderWidth: 3, tension: 0.3, pointRadius: 0, order: 1, yAxisID: 'y_rain' },
                    { type: 'line', label: 'ICON', data: rainData.de, borderColor: tc.warning, borderWidth: 2, borderDash: [4,4], tension: 0.3, pointRadius: 0, order: 1, yAxisID: 'y_rain' },
                    { type: 'line', label: 'JMA', data: rainData.jp, borderColor: '#ec4899', borderWidth: 2, tension: 0.3, pointRadius: 0, order: 1, yAxisID: 'y_rain' }
                ]
            },
            options: {
                animation: false, // Performance override for rapid telemetry updates
                responsive: true, 
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { 
                    legend: { 
                        display: true, 
                        labels: { color: '#9ca3af', font: {family: 'Inter', weight: 'bold', size: 12}, boxWidth: 16, usePointStyle: true }, 
                        position: 'bottom' 
                    },
                    tooltip: { 
                        backgroundColor: '#000', titleColor: '#fff', bodyColor: '#d1d5db', borderColor: '#333', borderWidth: 2, padding: 16, 
                        callbacks: {
                            label: function(c) { 
                                let l = c.dataset.label + ': ' || ''; 
                                if(c.parsed.y !== null) { 
                                    l += c.parsed.y.toFixed(1); 
                                    if(c.dataset.yAxisID === 'y_solar') l += ' W/m²'; 
                                    else if(c.dataset.yAxisID === 'y_uv') l += ' Index'; 
                                    else l += ' mm'; 
                                } 
                                return l; 
                            },
                            footer: function(t) { 
                                const i = t[0].dataIndex;
                                // Resolves dynamically through chart instance to prevent stale closure data retention
                                const uv = chartRefContext.chartInstance.data.datasets[1].data[i];
                                const solar = chartRefContext.chartInstance.data.datasets[0].data[i];
                                const rainAgr = chartRefContext.chartInstance.hourlyAgreementRef[i];
                                return `\nRain Model Agreement: ${rainAgr.toFixed(0)}%\nPeak UV: ${uv.toFixed(1)} | Solar: ${solar.toFixed(0)}W`; 
                            }
                        }, 
                        titleFont: { family: 'JetBrains Mono', size: 14, weight: 'bold' }, 
                        bodyFont: { family: 'JetBrains Mono', size: 12 }, 
                        footerFont: { family: 'JetBrains Mono', size: 12, weight: 'bold' }, 
                        footerColor: tc.teal
                    }
                }, 
                scales: {
                    x: { 
                        grid: { display: false }, 
                        ticks: { color: '#6b7280', maxTicksLimit: 12, font: {family: 'JetBrains Mono', size: 11, weight: 'bold'} } 
                    },
                    y_rain: { 
                        type: 'linear', display: true, position: 'left', 
                        title: { display: true, text: 'Precipitation (mm)', color: '#6b7280', font: {family:'Inter', size: 12, weight: 'bold'} }, 
                        grid: { color: '#2a2a2a' }, 
                        ticks: {color: '#9ca3af', font: {family: 'JetBrains Mono', size: 11, weight: 'bold'}}, 
                        suggestedMax: 2 
                    },
                    y_solar: { 
                        type: 'linear', display: true, position: 'right', 
                        title: { display: true, text: 'Solar Irradiance', color: tc.orange, font: {family:'Inter', size: 12, weight: 'bold'} }, 
                        grid: { drawOnChartArea: false }, 
                        ticks: {color: tc.orange, font: {family: 'JetBrains Mono', size: 11, weight: 'bold'}}, 
                        suggestedMax: 1000 
                    },
                    y_uv: { 
                        type: 'linear', display: false, min: 0, max: 15 
                    }
                }
            }
        });
        
        // Attach initial agreement reference
        this.chartInstance.hourlyAgreementRef = hourlyAgreement;
    }

    /**
     * Safely destroys the chart instance to prevent memory leaks during view teardown.
     */
    destroy() {
        if (this.chartInstance) {
            this.chartInstance.destroy();
            this.chartInstance = null;
        }
        if (this.chartWrapper) {
            this.chartWrapper.remove();
        }
    }
}