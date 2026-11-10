<template>
    <view v-if="state.page === 'devices'" class="screen" data-page="devices">
        <view class="brand">速驱智控</view>
        <view class="subtitle">蓝牙设备 · 原始数据透传</view>
        <view class="section">
            <view class="section-title">设备页</view>
            <view class="notice" role="status">{{ state.message || '正在检查蓝牙状态…' }}</view>
            <view class="actions">
                <button class="primary" data-action="scan" :disabled="['initializing', 'connecting', 'ready', 'disconnecting', 'disconnect-error'].includes(state.status)" @click="toggleScan">{{ state.scanning ? '停止扫描' : '重新扫描' }}</button>
                <button v-if="state.status === 'ready' || state.status === 'disconnect-error'" class="secondary" data-action="disconnect" @click="application.disconnect">{{ state.status === 'disconnect-error' ? '重试断开' : '断开连接' }}</button>
                <button v-if="state.status === 'connecting'" class="secondary" data-action="cancel" @click="application.cancelConnection">取消连接</button>
                <button v-if="state.status === 'unavailable'" class="secondary" @click="openSettings">系统设置</button>
            </view>
        </view>
        <view v-for="device in state.devices" :key="device.deviceId" class="device-card" :data-device="device.deviceId" @click="enterDevice(device)">
            <view class="device-name">{{ device.name }}</view>
            <view class="device-address">{{ device.deviceId }}</view>
            <view class="device-meta">信号 {{ device.rssi }} dBm <text :class="{ ready: isReady(device) }">{{ deviceStatus(device) }}</text></view>
            <button v-if="!isReady(device)" class="primary connect" :data-connect="device.deviceId" :disabled="['connecting', 'ready', 'disconnecting', 'disconnect-error'].includes(state.status)" @click.stop="application.connect(device.deviceId)">{{ state.currentDevice?.deviceId === device.deviceId && state.status === 'connecting' ? '连接中…' : '连接' }}</button>
        </view>
        <view v-if="!state.devices.length" class="empty">{{ state.scanning ? '正在寻找附近的蓝牙设备…' : '暂无设备' }}<br />请确认模块已开启</view>
    </view>
    <view v-else class="screen control-screen" data-page="control">
        <view class="control-heading">
            <button class="secondary" data-action="back" @click="application.backToDevices">返回设备页</button>
            <button v-if="state.status === 'ready' || state.status === 'disconnect-error'" class="secondary" data-action="disconnect" @click="application.disconnect">{{ state.status === 'disconnect-error' ? '重试断开' : '断开连接' }}</button>
            <button v-if="state.status === 'connecting'" class="secondary" data-action="cancel" @click="application.cancelConnection">取消连接</button>
            <button v-if="state.status === 'disconnected'" class="secondary" data-action="reconnect" @click="application.connect(state.currentDevice.deviceId)">重新连接</button>
            <text :class="{ ready: state.status === 'ready', failed: state.status !== 'ready' }">{{ connectionLabel() }}</text>
        </view>
        <view class="device-name control-device">{{ state.currentDevice?.name }}</view>
        <view class="device-address">{{ state.currentDevice?.deviceId }}</view>
        <view class="notice" role="status">{{ state.message }}</view>
        <view class="section data-panel">
            <view class="section-title">接收窗口</view>
            <scroll-view class="data-scroll" scroll-y>
                <view v-for="record in state.received" :key="record.id" class="data-record" data-direction="receive" :data-record-type="record.type">
                    <view v-if="record.type === 'marker'" class="session-marker">{{ record.time }} · {{ record.text }}</view>
                    <template v-else>
                        <view class="record-meta">{{ record.time }} · {{ record.length }} 字节</view>
                        <view class="record-bytes">{{ record.text }}</view>
                    </template>
                </view>
                <view v-if="!state.received.length" class="empty">等待设备数据</view>
            </scroll-view>
        </view>
        <view class="section data-panel send-panel">
            <view class="section-title">发送窗口</view>
            <scroll-view class="data-scroll" scroll-y>
                <view v-for="record in state.sent" :key="record.id" class="data-record" data-direction="send" :data-record-type="record.type">
                    <view v-if="record.type === 'marker'" class="session-marker">{{ record.time }} · {{ record.text }}</view>
                    <template v-else>
                        <view class="record-meta">{{ record.time }} · {{ record.length }} 字节 <text :class="record.status">{{ writeStatus(record) }}</text></view>
                        <view class="record-bytes">{{ record.text }}</view>
                    </template>
                </view>
                <view v-if="!state.sent.length" class="empty compact">暂无发送记录</view>
            </scroll-view>
            <view class="send-input-row">
                <textarea class="hex-input" :value="state.input" :maxlength="-1" placeholder="输入十六进制，例如 01 03 00 FF" aria-label="十六进制发送内容" @input="inputChanged" />
                <button class="primary send-button" data-action="send" :disabled="state.status !== 'ready' || state.sending" @click="application.send">{{ state.sending ? '发送中' : '发送' }}</button>
            </view>
            <view class="input-note">十六进制 · 写入结果不代表设备已执行</view>
        </view>
    </view>
</template>
<script setup>
//20261110-0 add - Observe the shared application instead of owning native listeners.
import { shallowRef, onMounted, onUnmounted } from 'vue';
import { application, platform } from '../../common/runtime.js';

const state = shallowRef({ ...application.state });
const unsubscribe = application.subscribe(observe);

/******************************************************************************
 * Function Name   : observe
 * Description     : Render a complete application transition in the device page.
 * Input Parameters: next
 * Return Value    : None
 * Date            : 2026.11.10
 ******************************************************************************/
function observe(next) {
    state.value = next;
}

/******************************************************************************
 * Function Name   : isReady
 * Description     : Identify the only device whose communication preparation has completed.
 * Input Parameters: device
 * Return Value    : True for the current ready device.
 * Date            : 2026.11.10
 ******************************************************************************/
function isReady(device) { //20261110-2 add
    return state.value.status === 'ready' && state.value.currentDevice?.deviceId === device.deviceId;
}

/******************************************************************************
 * Function Name   : deviceStatus
 * Description     : Describe connection preparation separately from a usable device.
 * Input Parameters: device
 * Return Value    : Localized device status.
 * Date            : 2026.11.10
 ******************************************************************************/
function deviceStatus(device) { //20261110-2 add
    if (isReady(device)) {
        return '已就绪';
    }
    if (state.value.currentDevice?.deviceId === device.deviceId) { //20261110-4 change
        return { connecting: '连接中', disconnecting: '断开中', 'disconnect-error': '断开未确认' }[state.value.status] || '未连接';
    }
    return '未连接';
}

/******************************************************************************
 * Function Name   : connectionLabel
 * Description     : Show uncertain cleanup separately from confirmed connection loss.
 * Input Parameters: None
 * Return Value    : Localized connection state.
 * Date            : 2026.11.10
 ******************************************************************************/
function connectionLabel() { //20261110-4 add
    return { ready: '已就绪', connecting: '连接中', disconnecting: '断开中', 'disconnect-error': '断开未确认', disconnected: '已断开', unavailable: '蓝牙不可用' }[state.value.status] || '未就绪';
}

/******************************************************************************
 * Function Name   : enterDevice
 * Description     : Enter control only when the user clicks the current ready card.
 * Input Parameters: device
 * Return Value    : None
 * Date            : 2026.11.10
 ******************************************************************************/
function enterDevice(device) { //20261110-2 add
    if (isReady(device)) {
        application.openControl();
    }
}

/******************************************************************************
 * Function Name   : inputChanged
 * Description     : Preserve hexadecimal input without silent truncation.
 * Input Parameters: event
 * Return Value    : None
 * Date            : 2026.11.10
 ******************************************************************************/
function inputChanged(event) { //20261110-3 add
    application.setInput(event.detail.value);
}

/******************************************************************************
 * Function Name   : writeStatus
 * Description     : Display the local write outcome independently of device execution.
 * Input Parameters: record
 * Return Value    : Localized status.
 * Date            : 2026.11.10
 ******************************************************************************/
function writeStatus(record) { //20261110-3 add
    return { pending: '等待结果', success: '写入成功', failed: '写入失败', unknown: '结果未知' }[record.status];
}

/******************************************************************************
 * Function Name   : toggleScan
 * Description     : Stop scanning or recheck system prerequisites before another scan.
 * Input Parameters: None
 * Return Value    : Promise for the operation.
 * Date            : 2026.11.10
 ******************************************************************************/
async function toggleScan() { //20261110-1 add
    if (state.value.scanning) {
        await application.stopScan();
    } else {
        await application.start();
    }
}

/******************************************************************************
 * Function Name   : openSettings
 * Description     : Open Android settings to recover missing system prerequisites.
 * Input Parameters: None
 * Return Value    : Promise for the settings operation.
 * Date            : 2026.11.10
 ******************************************************************************/
async function openSettings() { //20261110-1 add
    try {
        await platform.openSettings();
    } catch (error) {
        uni.showToast({ title: error.message, icon: 'none' });
    }
}

onMounted(application.start);
onUnmounted(unsubscribe);
</script>
