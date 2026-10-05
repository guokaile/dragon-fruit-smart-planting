/**
 * 图表模块：环境趋势图
 */

class TrendChart {
    constructor(canvasId) {
        this.ctx = document.getElementById(canvasId).getContext('2d');
        this.maxPoints = 30;
        this.labels = [];
        this.tempData = [];
        this.humidData = [];
        this.soilData = [];
        this.lightData = [];

        this.chart = new Chart(this.ctx, {
            type: 'line',
            data: {
                labels: this.labels,
                datasets: [
                    {
                        label: '空气温度 °C',
                        data: this.tempData,
                        borderColor: '#E67E22',
                        backgroundColor: 'rgba(230, 126, 34, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        fill: true
                    },
                    {
                        label: '空气湿度 %',
                        data: this.humidData,
                        borderColor: '#4A90D9',
                        backgroundColor: 'rgba(74, 144, 217, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        fill: true
                    },
                    {
                        label: '土壤湿度 %',
                        data: this.soilData,
                        borderColor: '#8B6914',
                        backgroundColor: 'rgba(139, 105, 20, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        fill: true
                    },
                    {
                        label: '光照强度 %',
                        data: this.lightData,
                        borderColor: '#F5A623',
                        backgroundColor: 'rgba(245, 166, 35, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        pointRadius: 0,
                        pointHoverRadius: 4,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        labels: {
                            color: '#5a7d5a',
                            font: { size: 11, family: 'Noto Sans SC' },
                            usePointStyle: true,
                            boxWidth: 8
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(26, 56, 26, 0.92)',
                        titleColor: '#81C784',
                        bodyColor: '#e8f5e9',
                        borderColor: 'rgba(76, 175, 80, 0.3)',
                        borderWidth: 1,
                        padding: 10,
                        displayColors: true
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: 'rgba(45, 138, 78, 0.08)'
                        },
                        ticks: {
                            color: '#7a9d7a',
                            font: { size: 10 }
                        }
                    },
                    y: {
                        grid: {
                            color: 'rgba(45, 138, 78, 0.08)'
                        },
                        ticks: {
                            color: '#7a9d7a',
                            font: { size: 10 }
                        },
                        suggestedMin: 0,
                        suggestedMax: 100
                    }
                },
                animation: {
                    duration: 600
                }
            }
        });
    }

    /**
     * 添加一个数据点
     */
    push(time, temp, humid, soil, light) {
        this.labels.push(time);
        this.tempData.push(temp);
        this.humidData.push(humid);
        this.soilData.push(soil);
        this.lightData.push(light);

        if (this.labels.length > this.maxPoints) {
            this.labels.shift();
            this.tempData.shift();
            this.humidData.shift();
            this.soilData.shift();
            this.lightData.shift();
        }

        this.chart.update('none');
    }
}

window.TrendChart = TrendChart;
