/**
 * 北方寒旱火龙果智能种植舱 - 主程序
 * 功能：蓝牙连接、数据展示、自动控制、AI助手、日志
 */

const App = {
    // 系统状态
    connected: false,
    mode: 'auto', // auto / manual
    ble: null,
    chart: null,
    simulatorTimer: null,
    dataTimer: null,
    
    // 当前传感器数据
    data: {
        temp: 26.5,
        humid: 68,
        soil: 45,
        light: 25,
        lightOn: false,
        mistOn: false
    },

    // 阈值
    thresholds: {
        soil: 30,
        light: 30,
        temp: 40
    },

    // 设备状态
    devices: {
        light: false,
        mist: false
    },

    init() {
        this.initSplash();
        this.initClock();
        this.initBluetooth();
        this.initControls();
        this.initThresholds();
        this.initAI();
        this.initChart();

        // 启动模拟数据（未连接时）
        this.startSimulator();

        // 每20秒请求一次数据
        this.dataTimer = setInterval(() => this.requestData(), 20000);

        this.log('系统初始化完成，等待连接', 'info');
    },

    // ================= 启动页 =================
    initSplash() {
        setTimeout(() => {
            document.getElementById('splash').classList.add('hide');
        }, 2200);
    },

    // ================= 时钟 =================
    initClock() {
        const update = () => {
            const now = new Date();
            document.getElementById('clock').textContent = now.toLocaleTimeString('zh-CN', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        };
        update();
        setInterval(update, 1000);
    },

    // ================= 连接管理（USB / 蓝牙） =================
    initBluetooth() {
        // 创建两种连接管理器
        this.bleManager = new BluetoothManager();
        this.serialManager = new SerialManager();
        // 当前活跃的连接器（根据用户选择切换）
        this.ble = this.serialManager; // 默认 USB

        // 统一回调绑定
        const setupCallbacks = (manager, label) => {
            manager.onConnect = (name) => {
                this.connected = true;
                this.stopSimulator();
                this.updateConnectionUI(true, name || '种植舱');
                this.log(`${label}已连接: ${name || 'Arduino'}`, 'success');
                this.addAIMessage(`${label}连接成功！`);
                document.querySelector('.live-tag').classList.add('active');
            };

            manager.onDisconnect = () => {
                this.connected = false;
                this.updateConnectionUI(false);
                this.log(`${label}已断开，切换到模拟数据模式`, 'warn');
                this.addAIMessage(`${label}已断开，当前显示模拟数据。`);
                document.querySelector('.live-tag').classList.remove('active');
                this.startSimulator();
            };

            manager.onDataReceived = (line) => {
                this.handleArduinoData(line);
            };

            manager.onError = (msg) => {
                this.log(`${label}错误: ${msg}`, 'error');
                this.toast(msg);
            };
        };

        setupCallbacks(this.bleManager, '蓝牙');
        setupCallbacks(this.serialManager, 'USB');

        // 连接方式切换
        document.querySelectorAll('input[name=connMethod]').forEach(radio => {
            radio.addEventListener('change', () => {
                if (this.connected) {
                    this.toast('请先断开当前连接再切换方式');
                    return;
                }
                const method = document.querySelector('input[name=connMethod]:checked').value;
                this.ble = (method === 'ble') ? this.bleManager : this.serialManager;
                this.connMethod = method;
                const desc = document.getElementById('connectDesc');
                if (method === 'ble') {
                    desc.textContent = '通过蓝牙连接 Arduino + HM-10 模块';
                } else {
                    desc.textContent = '通过 USB 线连接 Arduino（不需要额外模块）';
                }
            });
        });

        this.connMethod = 'serial';

        document.getElementById('connectBtn').addEventListener('click', async () => {
            const method = document.querySelector('input[name=connMethod]:checked').value;
            this.ble = (method === 'ble') ? this.bleManager : this.serialManager;
            try {
                if (method === 'ble') {
                    this.toast('请在弹窗中选择蓝牙设备（如 HM-10）');
                } else {
                    this.toast('请在弹窗中选择 Arduino 串口');
                }
                await this.ble.connect();
            } catch (e) {
                // 已在 onError 处理
            }
        });

        document.getElementById('disconnectBtn').addEventListener('click', () => {
            this.ble.disconnect();
        });
    },

    updateConnectionUI(connected, name) {
        const badge = document.getElementById('bleStatus');
        const connectBtn = document.getElementById('connectBtn');
        const disconnectBtn = document.getElementById('disconnectBtn');
        const desc = document.getElementById('connectDesc');

        if (connected) {
            badge.classList.add('connected');
            badge.querySelector('.text').textContent = `已连接 ${name}`;
            connectBtn.classList.add('hidden');
            disconnectBtn.classList.remove('hidden');
            desc.textContent = '蓝牙已连接，正在接收真实传感器数据';
            document.getElementById('systemState').textContent = '正常运行';
        } else {
            badge.classList.remove('connected');
            badge.querySelector('.text').textContent = '蓝牙未连接';
            connectBtn.classList.remove('hidden');
            disconnectBtn.classList.add('hidden');
            desc.textContent = '当前为演示模式，数据为模拟值。点击上方连接真实硬件。';
            document.getElementById('systemState').textContent = '模拟运行';
            document.getElementById('rssiValue').textContent = '-- dBm';
        }
    },

    // ================= 数据解析 =================
    handleArduinoData(line) {
        try {
            // 尝试解析 JSON
            if (line.startsWith('{')) {
                const json = JSON.parse(line);
                this.data = {
                    temp: json.T ?? json.temp ?? this.data.temp,
                    humid: json.H ?? json.humid ?? this.data.humid,
                    soil: json.S ?? json.soil ?? this.data.soil,
                    light: json.L ?? json.light ?? this.data.light,
                    lightOn: !!(json.lightOn ?? json.led ?? json.lightState),
                    mistOn: !!(json.mistOn ?? json.atomizer ?? json.mistState)
                };
            } else {
                // 简单格式：T:25.5,H:65,S:48,L:30
                const parts = line.split(',');
                const map = {};
                parts.forEach(p => {
                    const [k, v] = p.split(':');
                    if (k && v !== undefined) map[k.trim()] = parseFloat(v);
                });
                if (map.T !== undefined) this.data.temp = map.T;
                if (map.H !== undefined) this.data.humid = map.H;
                if (map.S !== undefined) this.data.soil = map.S;
                if (map.L !== undefined) this.data.light = map.L;
            }

            this.updateDashboard();
            this.autoControl();
            this.updateDeviceUI();
        } catch (e) {
            console.warn('数据解析失败:', line, e);
        }
    },

    // ================= 请求数据 =================
    async requestData() {
        if (this.connected && this.ble) {
            try {
                await this.ble.send('READ');
            } catch (e) {
                console.warn('请求数据失败:', e);
            }
        }
    },

    // ================= 模拟器 =================
    startSimulator() {
        if (this.simulatorTimer) return;
        this.log('启动模拟数据引擎', 'info');
        this.simulatorTimer = setInterval(() => {
            // 随机波动
            this.data.temp += (Math.random() - 0.5) * 0.8;
            this.data.humid += Math.floor((Math.random() - 0.5) * 3);
            this.data.soil += Math.floor((Math.random() - 0.5) * 4);
            this.data.light += Math.floor((Math.random() - 0.5) * 5);

            // 限制范围
            this.data.temp = Math.max(15, Math.min(45, this.data.temp));
            this.data.humid = Math.max(20, Math.min(95, this.data.humid));
            this.data.soil = Math.max(10, Math.min(90, this.data.soil));
            this.data.light = Math.max(0, Math.min(100, this.data.light));

            this.autoControl();
            this.updateDashboard();
            this.updateDeviceUI();
        }, 2500);
    },

    stopSimulator() {
        if (this.simulatorTimer) {
            clearInterval(this.simulatorTimer);
            this.simulatorTimer = null;
        }
    },

    // ================= 自动控制 =================
    autoControl() {
        if (this.mode !== 'auto') return;

        const shouldLight = this.data.light < this.thresholds.light;
        const shouldMist = this.data.soil < this.thresholds.soil;

        if (shouldLight !== this.devices.light) {
            this.setDevice('light', shouldLight, true);
        }
        if (shouldMist !== this.devices.mist) {
            this.setDevice('mist', shouldMist, true);
        }
    },

    // ================= 设置设备 =================
    async setDevice(name, on, fromAuto = false) {
        this.devices[name] = on;

        // 发送蓝牙命令
        if (this.connected && this.ble) {
            const cmdMap = {
                light: on ? 'LIGHT_ON' : 'LIGHT_OFF',
                mist: on ? 'ATOMIZER_ON' : 'ATOMIZER_OFF'
            };
            try {
                await this.ble.send(cmdMap[name]);
            } catch (e) {
                console.warn('发送命令失败:', e);
            }
        }

        // 日志
        const label = name === 'light' ? '补光灯' : '雾化器';
        const action = on ? '开启' : '关闭';
        const source = fromAuto ? '（自动）' : '（手动）';
        this.log(`${label}${action}${source}`, on ? 'success' : 'info');

        this.updateDeviceUI();
    },

    // ================= UI 更新 =================
    updateDashboard() {
        const { temp, humid, soil, light } = this.data;

        this.setGauge('temp', temp, 0, 50);
        this.setGauge('humid', humid, 0, 100);
        this.setGauge('soil', soil, 0, 100);
        this.setGauge('light', light, 0, 100);

        document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString('zh-CN');

        // 更新图表
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        if (this.chart) {
            this.chart.push(time, temp, humid, soil, light);
        }

        // 检查告警
        this.checkAlerts();
    },

    setGauge(type, value, min, max) {
        const percent = Math.max(0, Math.min(1, (value - min) / (max - min)));
        const offset = 326.72 * (1 - percent);
        document.getElementById(`${type}Arc`).style.strokeDashoffset = offset;

        const displayValue = type === 'temp' ? value.toFixed(1) : Math.round(value);
        document.getElementById(`${type}Value`).textContent = displayValue;
    },

    updateDeviceUI() {
        // 补光灯
        const lightSwitch = document.getElementById('switchLight');
        const lightCard = document.getElementById('cardLight');
        const lightText = document.getElementById('textLight');
        const vizLight = document.getElementById('vizLight');
        const tagLight = document.getElementById('tagLight');

        lightSwitch.checked = this.devices.light;
        lightCard.classList.toggle('on', this.devices.light);
        lightText.textContent = this.devices.light ? '已开启' : '已关闭';
        vizLight.classList.toggle('active', this.devices.light);
        tagLight.textContent = this.mode === 'auto' ? '自动' : '手动';
        tagLight.classList.toggle('manual', this.mode === 'manual');

        // 雾化器
        const mistSwitch = document.getElementById('switchMist');
        const mistCard = document.getElementById('cardMist');
        const mistText = document.getElementById('textMist');
        const vizMist = document.getElementById('vizMist');
        const tagMist = document.getElementById('tagMist');

        mistSwitch.checked = this.devices.mist;
        mistCard.classList.toggle('on', this.devices.mist);
        mistText.textContent = this.devices.mist ? '已开启' : '已关闭';
        vizMist.classList.toggle('active', this.devices.mist);
        tagMist.textContent = this.mode === 'auto' ? '自动' : '手动';
        tagMist.classList.toggle('manual', this.mode === 'manual');
    },

    // ================= 手动控制 =================
    initControls() {
        document.getElementById('switchLight').addEventListener('change', (e) => {
            if (this.mode === 'auto') {
                this.toast('当前为自动模式，切换手动模式后可手动控制');
                e.target.checked = this.devices.light;
                return;
            }
            this.setDevice('light', e.target.checked);
        });

        document.getElementById('switchMist').addEventListener('change', (e) => {
            if (this.mode === 'auto') {
                this.toast('当前为自动模式，切换手动模式后可手动控制');
                e.target.checked = this.devices.mist;
                return;
            }
            this.setDevice('mist', e.target.checked);
        });

        // 模式切换
        const segment = document.getElementById('modeSegment');
        segment.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                segment.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.mode = btn.dataset.mode;
                this.log(`切换为${this.mode === 'auto' ? '全自动' : '手动'}模式`, 'info');
                this.updateDeviceUI();
                if (this.mode === 'auto') {
                    this.autoControl();
                }
            });
        });
    },

    // ================= 阈值设置 =================
    initThresholds() {
        const inputs = {
            soil: { el: 'soilThreshold', display: 'soilThresholdVal', suffix: '%' },
            light: { el: 'lightThreshold', display: 'lightThresholdVal', suffix: '%' },
            temp: { el: 'tempThreshold', display: 'tempThresholdVal', suffix: '°C' }
        };

        for (const [key, cfg] of Object.entries(inputs)) {
            const el = document.getElementById(cfg.el);
            const disp = document.getElementById(cfg.display);

            el.addEventListener('input', () => {
                this.thresholds[key] = parseInt(el.value);
                disp.textContent = `${el.value}${cfg.suffix}`;
            });
        }
    },

    // ================= 告警检查 =================
    checkAlerts() {
        const { temp, humid, soil, light } = this.data;
        const issues = [];
        if (temp > this.thresholds.temp) issues.push('温度过高');
        if (soil < this.thresholds.soil) issues.push('土壤偏干');
        if (light < this.thresholds.light) issues.push('光照不足');
        if (humid < 60) issues.push('空气干燥');

        if (issues.length > 0 && Math.random() > 0.85) {
            this.log(`⚠️ ${issues.join('，')}`, 'warn');
        }
    },

    // ================= AI 助手 =================
    initAI() {
        document.getElementById('aiSend').addEventListener('click', () => this.handleAIQuery());
        document.getElementById('aiInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleAIQuery();
        });

        document.querySelectorAll('.ai-quick button').forEach(btn => {
            btn.addEventListener('click', () => {
                const q = btn.dataset.q;
                document.getElementById('aiInput').value = q;
                this.handleAIQuery();
            });
        });
    },

    handleAIQuery() {
        const input = document.getElementById('aiInput');
        const q = input.value.trim();
        if (!q) return;

        this.addUserMessage(q);
        input.value = '';

        // 简单规则 AI
        const reply = this.generateAIReply(q);
        setTimeout(() => this.addAIMessage(reply), 400);
    },

    generateAIReply(q) {
        const { temp, humid, soil, light } = this.data;
        const text = q.toLowerCase();

        if (text.includes('状态') || text.includes('怎么样')) {
            return `当前种植舱状态：温度 ${temp.toFixed(1)}°C，空气湿度 ${humid}%，土壤湿度 ${soil}%，光照 ${light}%。${soil < this.thresholds.soil ? '土壤偏干，雾化器' + (this.devices.mist ? '已自动开启' : '准备启动') + '。' : '环境总体适宜火龙果生长。'}`;
        }
        if (text.includes('湿度') || text.includes('干')) {
            return `土壤湿度 ${soil}%。${soil < this.thresholds.soil ? '已低于阈值 ${this.thresholds.soil}%，建议开启雾化器或检查土壤水分。' : '土壤湿度正常，无需额外灌溉。'}`;
        }
        if (text.includes('光') || text.includes('补光')) {
            return `当前光照 ${light}%。${light < this.thresholds.light ? '光照不足，补光灯' + (this.devices.light ? '已开启' : '建议开启') + '。' : '光照充足，火龙果光合作用良好。'}`;
        }
        if (text.includes('节能')) {
            return '节能建议：1) 白天光照充足时关闭补光灯；2) 土壤湿度达标后及时关闭雾化器；3) 夜间适当降低设备运行频率。';
        }
        if (text.includes('温度') || text.includes('热')) {
            return `当前温度 ${temp.toFixed(1)}°C。火龙果适宜温度为 25-35°C，${temp > 35 ? '当前偏高，建议通风降温。' : '当前温度适宜。'}`;
        }
        return '我已收到你的问题。你可以问我：当前状态、湿度低怎么办、光照不足、如何节能等。';
    },

    addUserMessage(text) {
        const chat = document.getElementById('aiChat');
        const div = document.createElement('div');
        div.className = 'ai-message';
        div.style.flexDirection = 'row-reverse';
        div.innerHTML = `
            <div class="ai-avatar" style="background: linear-gradient(135deg, #8b5cf6, #00d4ff);">👤</div>
            <div class="ai-bubble" style="border-top-left-radius: 14px; border-top-right-radius: 4px; background: rgba(0,255,136,0.08);">${this.escapeHtml(text)}</div>
        `;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    },

    addAIMessage(text) {
        const chat = document.getElementById('aiChat');
        const div = document.createElement('div');
        div.className = 'ai-message';
        div.innerHTML = `
            <div class="ai-avatar">🧑‍🌾</div>
            <div class="ai-bubble">${this.escapeHtml(text)}</div>
        `;
        chat.appendChild(div);
        chat.scrollTop = chat.scrollHeight;
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // ================= 图表 =================
    initChart() {
        this.chart = new TrendChart('trendChart');
        // 初始填充一些数据
        const now = new Date();
        for (let i = 29; i >= 0; i--) {
            const t = new Date(now.getTime() - i * 2000);
            const time = t.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
            this.chart.push(
                time,
                24 + Math.sin(i * 0.3) * 2,
                65 + Math.cos(i * 0.2) * 5,
                50 + Math.sin(i * 0.4) * 10,
                40 + Math.cos(i * 0.35) * 20
            );
        }
    },

    // ================= 日志 =================
    log(message, type = 'info') {
        const list = document.getElementById('logList');
        const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const li = document.createElement('li');
        li.className = type;
        li.innerHTML = `<span class="time">${time}</span><span>${message}</span>`;
        list.insertBefore(li, list.firstChild);

        // 最多保留 100 条
        while (list.children.length > 100) {
            list.removeChild(list.lastChild);
        }
    },

    // ================= Toast =================
    toast(message) {
        let toast = document.querySelector('.toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2800);
    }
};

// 启动应用
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
