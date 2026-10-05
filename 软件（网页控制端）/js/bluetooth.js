/**
 * 蓝牙通信模块 (Web Bluetooth API)
 * 适配 Arduino + HM-10 BLE 模块
 */

class BluetoothManager {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.txCharacteristic = null; // 写入 Arduino
        this.rxCharacteristic = null; // 接收 Arduino
        this.isConnected = false;
        this.buffer = '';

        // HM-10 常用 UUID (也可尝试 '0000ffe0-0000-1000-8000-00805f9b34fb')
        this.SERVICE_UUID = '0000ffe0-0000-1000-8000-00805f9b34fb';
        this.CHARACTERISTIC_UUID = '0000ffe1-0000-1000-8000-00805f9b34fb';

        this.onDataReceived = null;
        this.onConnect = null;
        this.onDisconnect = null;
        this.onError = null;
    }

    /**
     * 请求用户选择蓝牙设备并连接
     */
    async connect() {
        if (!navigator.bluetooth) {
            throw new Error('当前浏览器不支持 Web Bluetooth，请使用 Chrome/Android 浏览器');
        }

        try {
            this.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: false,
                filters: [
                    { namePrefix: 'HM-' },
                    { namePrefix: 'CC41' },
                    { namePrefix: 'BT05' },
                    { services: [this.SERVICE_UUID] }
                ],
                optionalServices: [this.SERVICE_UUID]
            });

            this.device.addEventListener('gattserverdisconnected', () => this.handleDisconnect());

            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(this.SERVICE_UUID);

            // HM-10 通常用一个特征同时收发
            this.rxCharacteristic = await this.service.getCharacteristic(this.CHARACTERISTIC_UUID);
            this.txCharacteristic = this.rxCharacteristic;

            // 监听数据
            await this.rxCharacteristic.startNotifications();
            this.rxCharacteristic.addEventListener('characteristicvaluechanged', (event) => {
                this.handleData(event.target.value);
            });

            this.isConnected = true;
            if (this.onConnect) this.onConnect(this.device);
            return true;

        } catch (error) {
            console.error('蓝牙连接失败:', error);
            if (this.onError) this.onError(error.message || '蓝牙连接失败');
            throw error;
        }
    }

    /**
     * 断开连接
     */
    disconnect() {
        if (this.server && this.server.connected) {
            this.server.disconnect();
        }
        this.handleDisconnect();
    }

    handleDisconnect() {
        this.isConnected = false;
        this.server = null;
        this.service = null;
        this.txCharacteristic = null;
        this.rxCharacteristic = null;
        if (this.onDisconnect) this.onDisconnect();
    }

    /**
     * 处理收到的数据（按行缓冲）
     */
    handleData(value) {
        const decoder = new TextDecoder('utf-8');
        const chunk = decoder.decode(value);
        this.buffer += chunk;

        // 按换行分割
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // 保留未完成部分

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && this.onDataReceived) {
                this.onDataReceived(trimmed);
            }
        }
    }

    /**
     * 发送命令到 Arduino
     */
    async send(command) {
        if (!this.isConnected || !this.txCharacteristic) {
            throw new Error('蓝牙未连接，无法发送命令');
        }
        const encoder = new TextEncoder();
        const data = encoder.encode(command + '\n');
        await this.txCharacteristic.writeValue(data);
    }

    /**
     * 获取 RSSI 信号强度（部分浏览器支持）
     */
    async getRSSI() {
        // Web Bluetooth 标准不直接暴露 RSSI，依赖 advertising 事件
        if (this.device && this.device.watchingAdvertisements) {
            return null;
        }
        return null;
    }
}

// 导出供 app.js 使用
window.BluetoothManager = BluetoothManager;
