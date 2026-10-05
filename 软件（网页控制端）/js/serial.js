/**
 * USB 串口通信模块 (Web Serial API)
 * 通过 USB 线直接连接 Arduino，不需要任何额外模块
 *
 * 使用条件：
 *   - Chrome / Edge 浏览器（桌面版或 Android 版）
 *   - 手机需要 OTG 数据线 + USB 线连接 Arduino
 *   - 电脑直接用 USB 线连 Arduino 即可
 */

class SerialManager {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isConnected = false;
        this.buffer = '';

        this.onDataReceived = null;
        this.onConnect = null;
        this.onDisconnect = null;
        this.onError = null;

        this.readLoopActive = false;
    }

    /**
     * 请求用户选择串口并连接
     */
    async connect() {
        if (!navigator.serial) {
            throw new Error('当前浏览器不支持 Web Serial，请使用 Chrome 或 Edge 浏览器');
        }

        try {
            // 弹窗让用户选择串口设备
            this.port = await navigator.serial.requestPort();

            // 打开串口，波特率 9600（和 Arduino 一致）
            await this.port.open({ baudRate: 9600 });

            // 获取写入器
            this.writer = this.port.writable.getWriter();

            this.isConnected = true;

            // 启动读取循环
            this.startReading();

            if (this.onConnect) this.onConnect('Arduino (USB)');
            return true;

        } catch (error) {
            console.error('串口连接失败:', error);
            if (this.onError) this.onError(error.message || '串口连接失败');
            throw error;
        }
    }

    /**
     * 断开连接
     */
    async disconnect() {
        this.readLoopActive = false;

        try {
            if (this.reader) {
                await this.reader.cancel();
                this.reader.releaseLock();
                this.reader = null;
            }
            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }
            if (this.port) {
                await this.port.close();
            }
        } catch (e) {
            console.warn('断开时出错:', e);
        }

        this.isConnected = false;
        this.port = null;
        if (this.onDisconnect) this.onDisconnect();
    }

    /**
     * 读取循环（持续监听 Arduino 发来的数据）
     */
    async startReading() {
        this.readLoopActive = true;
        const decoder = new TextDecoder();

        while (this.readLoopActive && this.port && this.port.readable) {
            try {
                this.reader = this.port.readable.getReader();

                while (this.readLoopActive) {
                    const { value, done } = await this.reader.read();
                    if (done) break;

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

                this.reader.releaseLock();
            } catch (error) {
                console.error('读取数据出错:', error);
                if (this.readLoopActive) {
                    try {
                        this.reader.releaseLock();
                    } catch (e) {}
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
    }

    /**
     * 发送命令到 Arduino
     */
    async send(command) {
        if (!this.isConnected || !this.writer) {
            throw new Error('串口未连接，无法发送命令');
        }
        const encoder = new TextEncoder();
        const data = encoder.encode(command + '\n');
        await this.writer.write(data);
    }
}

// 导出供 app.js 使用
window.SerialManager = SerialManager;
